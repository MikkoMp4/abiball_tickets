/* scan.js – QR-Code-Scanner für Einlass-Kontrolle
 *
 * Ablauf:
 *  1. Auth-Check → Login-Overlay oder direkt Scanner starten
 *  2. Kamera-Stream → zwei Canvas (bg: blur, vf: scharf + jsQR-Scan)
 *  3. Token → POST /api/admin/scan → Ergebnis-Overlay (grün/gelb/rot)
 *  4. Antippen → zurück zum Scanner
 *  5. Pille zeigt letzte 2 Scans; Tippen öffnet Verlauf-Modal
 */

'use strict';

// ── Helpers ───────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Auth ──────────────────────────────────────────────────────────────────
(async function initAuth() {
  const overlay = document.getElementById('loginOverlay');
  const stage   = document.getElementById('scannerStage');
  const input   = document.getElementById('loginInput');
  const btn     = document.getElementById('loginBtn');
  const errEl   = document.getElementById('loginError');

  // Bereits eingeloggt?
  try {
    const res = await fetch('/api/auth/check');
    if (res.ok) { revealScanner(); return; }
  } catch { /* Verbindungsfehler → Login zeigen */ }

  overlay.style.display = 'flex';

  async function attemptLogin() {
    const pw = input.value;
    if (!pw) return;
    btn.disabled = true;
    btn.textContent = '…';
    errEl.textContent = '';
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        revealScanner();
      } else {
        const d = await res.json();
        errEl.textContent = d.error || 'Falsches Passwort.';
        input.value = '';
        input.focus();
      }
    } catch {
      errEl.textContent = 'Verbindungsfehler.';
    }
    btn.disabled = false;
    btn.textContent = 'Einloggen';
  }

  btn.addEventListener('click', attemptLogin);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') attemptLogin(); });

  function revealScanner() {
    overlay.style.display = 'none';
    stage.style.display   = 'block';
    initScanner();
  }
})();

// ── Canvas & Video ────────────────────────────────────────────────────────
const rawVideo = document.getElementById('rawVideo');
const bgCanvas = document.getElementById('bgCanvas');
const vfCanvas = document.getElementById('vfCanvas');
const bgCtx    = bgCanvas.getContext('2d');
const vfCtx    = vfCanvas.getContext('2d', { willReadFrequently: true });

let scanningPaused = false; // true wenn Ergebnis-Overlay sichtbar oder Modal offen

// ── Kamera initialisieren ─────────────────────────────────────────────────
async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    rawVideo.srcObject = stream;
    await rawVideo.play();
    resizeCanvases();
    requestAnimationFrame(renderLoop);
  } catch (err) {
    // Fehlermeldung direkt im Scanner-Bereich anzeigen
    const stage = document.getElementById('scannerStage');
    const msg   = document.createElement('div');
    msg.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
      'flex-direction:column;gap:1rem;color:#fff;text-align:center;padding:2rem;';
    msg.innerHTML =
      `<div style="font-size:3rem">📷</div>` +
      `<strong style="font-size:1.1rem">Kamera nicht verfügbar</strong>` +
      `<span style="font-size:.9rem;opacity:.8">${esc(err.message)}</span>` +
      `<span style="font-size:.8rem;opacity:.65">HTTPS erforderlich · Kamera-Berechtigung prüfen</span>`;
    stage.appendChild(msg);
  }
}

function resizeCanvases() {
  bgCanvas.width  = window.innerWidth;
  bgCanvas.height = window.innerHeight;
  const vfRect    = vfCanvas.getBoundingClientRect();
  vfCanvas.width  = Math.round(vfRect.width)  || 280;
  vfCanvas.height = Math.round(vfRect.height) || 280;
}
window.addEventListener('resize', () => {
  resizeCanvases();
});

// ── Cover-Zeichnen: Video in Canvas skalieren (wie CSS object-fit:cover) ──
function drawCover(ctx, video, destW, destH) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  const videoRatio = vw / vh;
  const destRatio  = destW / destH;
  let sx, sy, sw, sh;
  if (videoRatio > destRatio) {
    sh = vh; sw = vh * destRatio; sx = (vw - sw) / 2; sy = 0;
  } else {
    sw = vw; sh = vw / destRatio; sx = 0; sy = (vh - sh) / 2;
  }
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, destW, destH);
}

// ── Render-Loop ───────────────────────────────────────────────────────────
let lastScanAt     = 0;
const SCAN_THROTTLE_MS = 250; // jsQR nicht bei jedem Frame (Performance)

function renderLoop(ts) {
  if (!scanningPaused) {
    // Hintergrund (blur via CSS)
    drawCover(bgCtx, rawVideo, bgCanvas.width, bgCanvas.height);

    // Viewfinder: quadratischer Mittelausschnitt des Videos
    const vw = rawVideo.videoWidth, vh = rawVideo.videoHeight;
    if (vw && vh) {
      const side = Math.min(vw, vh);
      const sx   = (vw - side) / 2;
      const sy   = (vh - side) / 2;
      vfCtx.drawImage(rawVideo, sx, sy, side, side, 0, 0, vfCanvas.width, vfCanvas.height);

      if (ts - lastScanAt > SCAN_THROTTLE_MS) {
        lastScanAt = ts;
        tryDecode();
      }
    }
  }
  requestAnimationFrame(renderLoop);
}

// ── QR-Dekodierung ────────────────────────────────────────────────────────
function tryDecode() {
  const imgData = vfCtx.getImageData(0, 0, vfCanvas.width, vfCanvas.height);
  const code    = jsQR(imgData.data, imgData.width, imgData.height);
  if (code && code.data) handleDecodedToken(code.data);
}

// ── Token an API schicken ─────────────────────────────────────────────────
async function handleDecodedToken(rawData) {
  // Direkt pausieren → kein Doppel-Scan während der API-Anfrage
  scanningPaused = true;

  let token;
  try {
    // QR-Payload ist JSON: { token, ticketId, orderId, personCode, name }
    token = JSON.parse(rawData).token;
  } catch {
    // Fallback: roher String (z. B. fremder QR-Code)
    token = rawData;
  }

  try {
    const res  = await fetch('/api/admin/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    showResult(data);
    pushToRecentScans(data);
  } catch {
    showResult({ valid: false, reason: 'network_error' });
  }
}

// ── Farblogik ─────────────────────────────────────────────────────────────
function getResultState(data) {
  if (!data.valid)           return { color: 'red',    label: 'Ungültiges Ticket' };
  if (!data.paid)            return { color: 'red',    label: 'NICHT BEZAHLT' };
  if (data.priorScans >= 2)  return { color: 'red',    label: 'Bereits mehrfach gescannt!' };
  if (data.priorScans === 1) return { color: 'yellow', label: 'Bereits gescannt!' };
  return { color: 'green', label: 'Gültig – Einlass OK' };
}

// ── Ergebnis-Overlay anzeigen ─────────────────────────────────────────────
function showResult(data) {
  const state   = getResultState(data);
  const overlay = document.getElementById('resultOverlay');
  const icons   = { green: '✅', yellow: '⚠️', red: '❌' };

  overlay.className = `result-overlay result-${state.color}`;
  document.getElementById('resultIcon').textContent   = icons[state.color] || '❓';
  document.getElementById('resultStatus').textContent = state.label;
  document.getElementById('resultName').textContent   = data.valid ? (data.personName || '') : '';
  document.getElementById('resultMeta').textContent   = data.valid
    ? `Ticket #${data.ticketId} · ${data.scanNumber}. Scan`
    : '';

  overlay.style.display = 'flex';
}

// Tippen auf Ergebnis → zurück zur Kamera
document.getElementById('resultOverlay').addEventListener('click', () => {
  document.getElementById('resultOverlay').style.display = 'none';
  scanningPaused = false;
});

// ── Letzte Scans: Pille + Verlauf-Modal ──────────────────────────────────
let recentScans = []; // neueste zuerst

function statusIcon(data) {
  const s = getResultState(data);
  if (s.color === 'green')  return '✅';
  if (s.color === 'yellow') return '⚠️';
  return '❗';
}

function pushToRecentScans(data) {
  recentScans.unshift({ ...data, icon: statusIcon(data), ts: Date.now() });
  recentScans = recentScans.slice(0, 100); // max. 100 Einträge im Speicher
  renderPill();
}

function renderPill() {
  const last2   = recentScans.slice(0, 2);
  const content = last2.length
    ? last2.map(s => `<span>${s.icon} ${esc(s.personName || '–')}</span>`)
           .join('<span class="pill-sep">·</span>')
    : 'Noch keine Scans';
  document.getElementById('pillContent').innerHTML = content;
}

// Pille antippen → Verlauf öffnen (Kamera pausieren)
document.getElementById('scanPill').addEventListener('click', () => {
  scanningPaused = true;
  renderHistoryList();
  document.getElementById('historyModal').style.display = 'flex';
});

// Modal schließen → Kamera fortsetzen
document.getElementById('closeHistoryBtn').addEventListener('click', () => {
  document.getElementById('historyModal').style.display = 'none';
  scanningPaused = false;
});

// Modal-Backdrop antippen → ebenfalls schließen
document.getElementById('historyModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) {
    document.getElementById('historyModal').style.display = 'none';
    scanningPaused = false;
  }
});

function renderHistoryList() {
  const el = document.getElementById('historyList');
  if (!recentScans.length) {
    el.innerHTML = '<p class="history-empty">Noch keine Scans in dieser Session.</p>';
    return;
  }
  el.innerHTML = recentScans.map(s => `
    <div class="history-row">
      <span class="history-icon">${s.icon}</span>
      <div class="history-info">
        <strong>${esc(s.personName || 'Unbekannt')}</strong>
        <span>Ticket #${s.ticketId ?? '–'}${s.paid === false ? ' · NICHT BEZAHLT' : ''}</span>
      </div>
      <span class="history-time">${new Date(s.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>
    </div>
  `).join('');
}

// ── Init: History laden + Kamera starten ──────────────────────────────────
async function initScanner() {
  // Server-History vorladen (für den Fall dass die Seite neu geladen wurde)
  try {
    const res  = await fetch('/api/admin/scan/history?limit=20');
    const data = await res.json();
    if (data.scans && data.scans.length) {
      recentScans = data.scans.map(s => ({
        valid:      true,
        paid:       !!s.was_paid,
        priorScans: s.scan_number - 1,
        scanNumber: s.scan_number,
        personName: s.person_name,
        ticketName: s.ticket_name,
        ticketId:   s.ticket_id,
        ts:         new Date(s.scanned_at).getTime(),
      })).map(s => ({ ...s, icon: statusIcon(s) }));
      renderPill();
    }
  } catch { /* bei Fehler einfach leer beginnen */ }

  await initCamera();
}