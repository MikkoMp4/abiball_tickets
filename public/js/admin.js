/* admin.js – Admin-Dashboard */

// ── Auth ──────────────────────────────────────────────────────────────────
(async function initAuth() {
  const overlay = document.getElementById('loginOverlay');
  const content = document.getElementById('adminContent');
  const input   = document.getElementById('loginInput');
  const btn     = document.getElementById('loginBtn');
  const errEl   = document.getElementById('loginError');

  try {
    const res = await fetch('/api/auth/check');
    if (res.ok) { showAdminContent(); return; }
  } catch { /* show login */ }

  overlay.style.display = 'flex';

  async function attemptLogin() {
    const pw = input.value;
    if (!pw) return;
    btn.disabled = true; btn.textContent = '…'; errEl.textContent = '';
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) { showAdminContent(); }
      else { const d = await res.json(); errEl.textContent = d.error || 'Falsches Passwort.'; input.value = ''; input.focus(); }
    } catch { errEl.textContent = 'Verbindungsfehler.'; }
    btn.disabled = false; btn.textContent = 'Einloggen';
  }

  btn.addEventListener('click', attemptLogin);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') attemptLogin(); });

  function showAdminContent() {
    overlay.style.display = 'none';
    content.style.display = 'block';
    initDashboard();
  }
})();

// ── Logout ──────────────────────────────────────────────────────────────────
document.getElementById('logoutBtn')?.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.reload();
});

// ── Main init ──────────────────────────────────────────────────────────────
function initDashboard() {
  setupTabs();
  loadStats(); loadDashUnpaid(); loadOrders(); loadPersons(); loadPayments();
  loadSettings(); setupSettingsSave(); setupCsvUpload(); setupPdfUpload(); setupGenerateCodes();
}

// ── Tabs ───────────────────────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function showAlert(id, msg, type = 'danger') {
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
}
function clearAlert(id) { const el = document.getElementById(id); if (el) el.innerHTML = ''; }
function fmt(eur) {
  return eur != null ? Number(eur).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) : '–';
}
function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function setBtn(id, disabled, html) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = disabled; btn.innerHTML = html;
}

/**
 * Badge für den Bezahlstatus einer Bestellung.
 *   paid=0 → Ausstehend  (gelb)
 *   paid=1 → Bezahlt     (grün)
 *   paid=2 → Teilzahlung (orange)
 */
function paidBadge(order) {
  if (order.paid === 1) {
    return `<span class="badge badge-success">✓ Bezahlt</span>` +
           `<br><span style="font-size:.75rem;color:var(--muted)">${esc(order.paid_at?.slice(0,16)||'')}</span>`;
  }
  if (order.paid === 2) {
    const paidAmt = fmt(order.paid_amount);
    const total   = fmt(order.total_eur);
    return `<span class="badge" style="background:#fff3cd;color:#856404;border:1px solid #ffc107">⚠️ Teilzahlung</span>` +
           `<br><span style="font-size:.75rem;color:var(--muted)">${paidAmt} von ${total}</span>`;
  }
  return '<span class="badge badge-warning">Ausstehend</span>';
}

/** Badge für ein einzelnes Split-Ticket */
function splitTicketBadge(ticket) {
  if (ticket.split_paid_at) {
    return `<span class="badge badge-success" title="Bezahlt am ${esc(ticket.split_paid_at?.slice(0,16)||'')}" style="font-size:.7rem">✓ ${fmt(ticket.split_amount)}</span>`;
  }
  return `<span class="badge badge-warning" style="font-size:.7rem">ausstehend</span>`;
}

// ── Stats ─────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const res = await fetch('/api/admin/stats');
    if (res.status === 401) return;
    const data = await res.json();
    document.getElementById('st-persons').textContent     = data.totalPersons;
    document.getElementById('st-orders').textContent      = data.totalOrders;
    document.getElementById('st-paid').textContent        = data.paidOrders;
    document.getElementById('st-partial').textContent     = data.partialOrders ?? '–';
    document.getElementById('st-unpaid').textContent      = data.unpaidOrders;
    document.getElementById('st-tickets').textContent     = data.totalTickets;
    document.getElementById('st-revenue').textContent     = fmt(data.totalRevenue);
    document.getElementById('st-partial-rev').textContent = fmt(data.partialRevenue);
    document.getElementById('st-pending-rev').textContent = fmt(data.pendingRevenue);
    document.getElementById('st-payments').textContent    = `${data.matchedPayments} / ${data.totalPayments}`;
  } catch { /* silent */ }
}

async function loadDashUnpaid() {
  try {
    const res  = await fetch('/api/admin/orders');
    if (res.status === 401) return;
    const data  = await res.json();
    const unpaid = (data.orders || []).filter(o => o.paid !== 1);
    const tbody  = document.getElementById('dashUnpaidTbody');
    if (!unpaid.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted)">Alle Bestellungen vollständig bezahlt 🎉</td></tr>';
      return;
    }
    tbody.innerHTML = unpaid.map(o =>
      `<tr><td><strong>${esc(o.person_name)}</strong></td><td><code>${esc(o.person_code)}</code></td>` +
      `<td>${o.ticket_count}</td><td>${fmt(o.total_eur)}</td>` +
      `<td>${paidBadge(o)}</td>` +
      `<td style="font-size:.82rem;color:var(--muted)">${esc(o.created_at?.slice(0,16)||'')}</td></tr>`
    ).join('');
  } catch { showAlert('dashUnpaidAlert', 'Fehler beim Laden.'); }
}

// ── Persons ────────────────────────────────────────────────────────────────
async function loadPersons() {
  try {
    const res  = await fetch('/api/admin/persons');
    if (res.status === 401) return;
    const data = await res.json();
    renderPersons(data.persons || []);
  } catch { showAlert('personsAlert', 'Fehler beim Laden der Personen.'); }
}

function renderPersons(persons) {
  const tbody = document.getElementById('personsTbody');
  if (!persons.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted)">Keine Personen vorhanden.</td></tr>';
    return;
  }
  tbody.innerHTML = persons.map(p => `
    <tr>
      <td><span class="badge badge-muted" title="Person-ID">#${p.id}</span></td>
      <td><strong>${esc(p.name)}</strong></td>
      <td><code>${esc(p.code)}</code></td>
      <td>${p.num_tickets}</td>
      <td>${p.has_order ? '<span class="badge badge-warning">Ja</span>' : '<span class="badge badge-muted">Nein</span>'}</td>
      <td>${p.is_paid ? '<span class="badge badge-success">Bezahlt</span>' : '<span class="badge badge-muted">Offen</span>'}</td>
      <td style="font-size:.82rem;color:var(--muted)">${esc(p.created_at?.slice(0,16)||'')}</td>
      <td><button class="btn btn-danger" style="padding:.3rem .7rem;font-size:.8rem" onclick="deletePerson(${p.id})">🗑</button></td>
    </tr>`).join('');
}

window.deletePerson = async function(id) {
  if (!confirm('Person und Code wirklich löschen?')) return;
  const res = await fetch(`/api/admin/persons/${id}`, { method: 'DELETE' });
  if (res.ok) { loadPersons(); loadStats(); }
  else showAlert('personsAlert', 'Fehler beim Löschen.');
};

// ── Generate codes ─────────────────────────────────────────────────────────
function setupGenerateCodes() {
  document.getElementById('generateBtn')?.addEventListener('click', async () => {
    clearAlert('genAlert');
    const raw = document.getElementById('personsBulk').value.trim();
    if (!raw) { showAlert('genAlert', 'Bitte Personen eingeben.', 'warning'); return; }
    const persons = raw.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
      const parts = line.split(';').map(s => s.trim());
      return { name: parts[0] || 'Unbekannt', numTickets: parseInt(parts[1], 10) || 1 };
    });
    setBtn('generateBtn', true, '<span class="spinner"></span> Generiere…');
    try {
      const res  = await fetch('/api/admin/generate-codes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persons }) });
      const data = await res.json();
      if (!res.ok) { showAlert('genAlert', data.error || 'Fehler.'); return; }
      showAlert('genAlert', `✅ ${data.created.length} Code(s) erfolgreich generiert.`, 'success');
      document.getElementById('personsBulk').value = '';
      loadPersons(); loadStats();
    } catch { showAlert('genAlert', 'Verbindungsfehler.'); }
    finally { setBtn('generateBtn', false, 'Codes generieren'); }
  });
}

// ── Orders ──────────────────────────────────────────────────────────────────
let allOrders = [];
async function loadOrders() {
  try {
    const res  = await fetch('/api/admin/orders');
    if (res.status === 401) return;
    const data = await res.json();
    allOrders  = data.orders || [];
    renderOrders(allOrders);
  } catch { showAlert('ordersAlert', 'Fehler beim Laden der Bestellungen.'); }
}

function renderOrders(orders) {
  const filter = document.getElementById('ordersFilter')?.value || 'all';
  let filtered = orders;
  if (filter === 'paid')    filtered = orders.filter(o => o.paid === 1);
  if (filter === 'partial') filtered = orders.filter(o => o.paid === 2);
  if (filter === 'unpaid')  filtered = orders.filter(o => o.paid === 0);
  if (filter === 'split')   filtered = orders.filter(o => o.split_payment);

  const tbody = document.getElementById('ordersTbody');
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--muted)">Keine Bestellungen vorhanden.</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(o => {
    const ticketRows = (o.tickets || []).map((t, i) => {
      const splitBadgeHtml = o.split_payment
        ? `<span style="margin-left:.3rem">${splitTicketBadge(t)}</span>`
        : '';
      const splitRefHtml = o.split_payment && t.split_ref
        ? `<code style="font-size:.7rem;color:var(--muted);display:block">${esc(t.split_ref)}</code>`
        : '';
      return `<div style="display:flex;align-items:center;gap:.5rem;padding:.25rem 0;border-bottom:1px solid #eee">
        <span style="font-size:.8rem;color:#777">T${i+1}</span>
        <span style="flex:1;font-size:.85rem">
          ${esc(t.ticket_name)} &lt;${esc(t.ticket_email || '–')}&gt;
          ${splitRefHtml}
        </span>
        ${splitBadgeHtml}
        ${o.paid !== 1
          ? `<button class="btn btn-danger" style="padding:.2rem .5rem;font-size:.75rem" onclick="adminDeleteTicket(${o.id},${t.id},this)">🗑</button>`
          : `<span class="badge badge-muted" style="font-size:.7rem">bezahlt</span>`
        }
      </div>`;
    }).join('');

    const splitIcon = o.split_payment
      ? `<span title="Separat-Zahlung" style="margin-left:.4rem;font-size:.8rem">💳</span>`
      : '';

    return `<tr>
      <td><span class="badge badge-muted" title="Bestellungs-ID">#${o.id}</span></td>
      <td><strong>${esc(o.person_name)}</strong></td>
      <td><code>${esc(o.person_code)}</code></td>
      <td style="min-width:220px">${ticketRows || '–'}</td>
      <td>${fmt(o.total_eur)}${splitIcon}</td>
      <td>${paidBadge(o)}</td>
      <td style="font-size:.82rem;color:var(--muted)">${esc(o.created_at?.slice(0,16)||'')}</td>
      <td>${o.paid !== 1
        ? `<button class="btn btn-success" style="padding:.3rem .7rem;font-size:.8rem" onclick="markPaid(${o.id},this)">✓ Als bezahlt markieren</button>`
        : ''}</td>
    </tr>`;
  }).join('');
}

document.getElementById('ordersFilter')?.addEventListener('change', () => renderOrders(allOrders));

window.markPaid = async function(orderId, btn) {
  if (!confirm('Bestellung manuell als bezahlt markieren?')) return;
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    const res  = await fetch(`/api/admin/orders/${orderId}/mark-paid`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) { loadOrders(); loadStats(); loadDashUnpaid(); }
    else { showAlert('ordersAlert', data.error || 'Fehler.'); btn.disabled = false; btn.textContent = '✓ Als bezahlt markieren'; }
  } catch { showAlert('ordersAlert', 'Verbindungsfehler.'); btn.disabled = false; btn.textContent = '✓ Als bezahlt markieren'; }
};

window.adminDeleteTicket = async function(orderId, ticketId, btn) {
  if (!confirm('Dieses Ticket wirklich löschen?')) return;
  btn.disabled = true; btn.innerHTML = '…';
  try {
    const res  = await fetch(`/api/admin/orders/${orderId}/ticket/${ticketId}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok) {
      showAlert('ordersAlert', `✅ Ticket gelöscht. Neuer Gesamtbetrag: ${fmt(data.newTotalEur)}`, 'success');
      loadOrders(); loadStats();
    } else if (data.error === 'paid_order') {
      showAlert('ordersAlert', '⚠️ Diese Bestellung wurde bereits bezahlt. Bitte die <strong>Danger Zone</strong> verwenden.', 'warning');
      btn.disabled = false; btn.innerHTML = '🗑';
    } else if (data.error === 'last_ticket') {
      showAlert('ordersAlert', '⚠️ Mindestens ein Ticket muss verbleiben.', 'warning');
      btn.disabled = false; btn.innerHTML = '🗑';
    } else {
      showAlert('ordersAlert', data.message || data.error || 'Fehler beim Löschen.');
      btn.disabled = false; btn.innerHTML = '🗑';
    }
  } catch {
    showAlert('ordersAlert', 'Verbindungsfehler.');
    btn.disabled = false; btn.innerHTML = '🗑';
  }
};

// ── Payments ────────────────────────────────────────────────────────────────
async function loadPayments() {
  try {
    const res  = await fetch('/api/payments');
    const data = await res.json();
    renderPayments(data.payments || []);
  } catch { showAlert('paymentsAlert', 'Fehler beim Laden der Zahlungen.'); }
}

function renderPayments(payments) {
  const tbody = document.getElementById('paymentsTbody');
  if (!payments.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted)">Keine Zahlungen vorhanden.</td></tr>';
    return;
  }
  tbody.innerHTML = payments.map(p => `<tr>
    <td><span class="badge badge-muted" title="Zahlungs-ID">#${p.id}</span></td>
    <td style="font-size:.82rem">${esc(p.booking_date||'–')}</td>
    <td>${esc(p.sender_name||'–')}</td>
    <td style="font-size:.82rem;max-width:180px;overflow:hidden;text-overflow:ellipsis">${esc(p.reference||'–')}</td>
    <td>${fmt(p.amount_eur)}</td>
    <td>${p.person_name ? `<strong>${esc(p.person_name)}</strong>` : '<span style="color:var(--muted)">nicht zugeordnet</span>'}</td>
    <td>${p.matched ? (p.qr_sent ? '<span class="badge badge-success">QR gesendet</span>' : '<span class="badge badge-warning">Zahlung ok</span>') : '<span class="badge badge-muted">offen</span>'}</td>
    <td>${p.matched && !p.qr_sent ? `<button class="btn btn-success" style="padding:.3rem .7rem;font-size:.8rem" onclick="sendTickets(${p.id},this)">✉ Tickets senden</button>` : ''}</td>
  </tr>`).join('');
}

window.sendTickets = async function(paymentId, btn) {
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    const res  = await fetch(`/api/payments/${paymentId}/send`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) { showAlert('paymentsAlert', `✅ Tickets an ${(data.sentTo||[]).join(', ')} gesendet.`, 'success'); loadPayments(); }
    else { showAlert('paymentsAlert', data.error || 'Fehler beim Senden.'); btn.disabled = false; btn.textContent = '✉ Tickets senden'; }
  } catch { showAlert('paymentsAlert', 'Verbindungsfehler.'); btn.disabled = false; btn.textContent = '✉ Tickets senden'; }
};

// ── PDF Upload ─────────────────────────────────────────────────────────────
function setupPdfUpload() {
  document.getElementById('pdfUploadBtn')?.addEventListener('click', async () => {
    const fi = document.getElementById('pdfFiles');
    if (!fi.files.length) { showAlert('pdfUploadAlert', 'Bitte mindestens eine PDF-Datei auswählen.', 'warning'); return; }
    setBtn('pdfUploadBtn', true, '<span class="spinner"></span> Verarbeite PDFs…');
    clearAlert('pdfUploadAlert');
    document.getElementById('pdfResultCard').style.display = 'none';
    const form = new FormData();
    for (const f of fi.files) form.append('pdfs', f);
    try {
      const res  = await fetch('/api/admin/upload-pdf', { method: 'POST', body: form });
      const data = await res.json();
      if (res.ok) {
        showAlert('pdfUploadAlert', `✅ ${data.newlyPaid || 0} neue Zahlung(en) importiert.`, 'success');
        document.getElementById('pdfResultCard').style.display = 'block';
        document.getElementById('pdfResultContent').innerHTML = `<p>Verarbeitet: <strong>${data.processed||0}</strong>, davon neu bezahlt: <strong>${data.newlyPaid||0}</strong></p>`;
        loadPayments(); loadStats(); loadOrders(); loadDashUnpaid();
      } else { showAlert('pdfUploadAlert', data.error || 'Fehler beim Verarbeiten.'); }
    } catch { showAlert('pdfUploadAlert', 'Verbindungsfehler.'); }
    finally { setBtn('pdfUploadBtn', false, '📤 PDFs hochladen &amp; abgleichen'); }
  });
}

// ── CSV Upload ─────────────────────────────────────────────────────────────
function setupCsvUpload() {
  document.getElementById('csvUploadBtn')?.addEventListener('click', async () => {
    const fi = document.getElementById('statementFile');
    if (!fi.files.length) { showAlert('csvUploadAlert', 'Bitte eine Datei auswählen.', 'warning'); return; }
    setBtn('csvUploadBtn', true, '<span class="spinner"></span> Verarbeite…');
    clearAlert('csvUploadAlert');
    const form = new FormData();
    form.append('statement', fi.files[0]);
    try {
      const res  = await fetch('/api/admin/upload-statement', { method: 'POST', body: form });
      const data = await res.json();
      if (res.ok) {
        let msg = `✅ ${data.inserted} neue Zahlung(en), ${data.matched} zugeordnet.`;
        if (data.splitPaid > 0) msg += ` ${data.splitPaid} Einzel-Ticket(s) als bezahlt markiert.`;
        showAlert('csvUploadAlert', msg, 'success');
        loadPayments(); loadStats(); loadOrders(); loadDashUnpaid();
      } else { showAlert('csvUploadAlert', data.error || 'Fehler beim Verarbeiten.'); }
    } catch { showAlert('csvUploadAlert', 'Verbindungsfehler.'); }
    finally { setBtn('csvUploadBtn', false, 'Hochladen &amp; prüfen'); }
  });
}

// ── Settings ────────────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const res  = await fetch('/api/admin/settings');
    if (res.status === 401) return;
    const data = await res.json();
    const s    = data.settings || {};
    document.getElementById('s-event-name').value     = s.event_name     || '';
    document.getElementById('s-event-date').value     = s.event_date     || '';
    document.getElementById('s-event-location').value = s.event_location || '';
    document.getElementById('s-ticket-price').value   = s.ticket_price   || '';
    document.getElementById('s-bank-name').value      = s.bank_recipient || '';
    document.getElementById('s-bank-iban').value      = s.bank_iban      || '';
    document.getElementById('s-bank-bic').value       = s.bank_bic       || '';
    document.getElementById('settingsPreview').textContent = JSON.stringify(s, null, 2);
    const envDiv = document.getElementById('envStatusContent');
    if (envDiv && data.envStatus) {
      envDiv.innerHTML = Object.entries(data.envStatus).map(([k, v]) =>
        `<div style="display:flex;justify-content:space-between;padding:.3rem 0;border-bottom:1px solid var(--border)">
          <code style="font-size:.85rem">${esc(k)}</code>
          <span class="badge ${v ? 'badge-success' : 'badge-muted'}">${v ? '✅ Gesetzt' : '❌ Nicht gesetzt'}</span>
        </div>`
      ).join('');
    }
  } catch { /* silent */ }
}

function setupSettingsSave() {
  document.getElementById('saveEventBtn')?.addEventListener('click', async () => {
    clearAlert('settingsEventAlert');
    const body = { event_name: document.getElementById('s-event-name').value, event_date: document.getElementById('s-event-date').value, event_location: document.getElementById('s-event-location').value, ticket_price: parseFloat(document.getElementById('s-ticket-price').value) || null };
    try {
      const res = await fetch('/api/admin/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) showAlert('settingsEventAlert', '✅ Gespeichert.', 'success');
      else        showAlert('settingsEventAlert', 'Fehler beim Speichern.');
      loadSettings();
    } catch { showAlert('settingsEventAlert', 'Verbindungsfehler.'); }
  });
  document.getElementById('saveBankBtn')?.addEventListener('click', async () => {
    clearAlert('settingsBankAlert');
    const body = { bank_recipient: document.getElementById('s-bank-name').value, bank_iban: document.getElementById('s-bank-iban').value, bank_bic: document.getElementById('s-bank-bic').value };
    try {
      const res = await fetch('/api/admin/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) showAlert('settingsBankAlert', '✅ Gespeichert.', 'success');
      else        showAlert('settingsBankAlert', 'Fehler beim Speichern.');
      loadSettings();
    } catch { showAlert('settingsBankAlert', 'Verbindungsfehler.'); }
  });
}

// ── DANGER ZONE ──────────────────────────────────────────────────────────────
function getDangerPw() {
  const pw = document.getElementById('dangerPwInput')?.value || '';
  if (!pw) { showDangerResult('Bitte zuerst das Danger-Passwort eingeben.', 'error'); return null; }
  return pw;
}
function showDangerResult(msg, type) {
  const el = document.getElementById('dangerResult');
  el.className = type; el.textContent = msg;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

window.dangerDeletePerson = async function() {
  const pw = getDangerPw(); if (!pw) return;
  const id = document.getElementById('dangerPersonId').value;
  if (!id) { showDangerResult('Bitte eine Person-ID eingeben.', 'error'); return; }
  if (!confirm(`Person #${id} und alle zugehörigen Daten unwiderruflich löschen?`)) return;
  try {
    const res  = await fetch(`/api/admin/danger/person/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dangerPassword: pw }) });
    const data = await res.json();
    if (res.ok) { showDangerResult(`✅ Person "${data.name}" (ID ${data.id}) gelöscht.`, 'success'); loadPersons(); loadStats(); loadOrders(); loadDashUnpaid(); }
    else showDangerResult(data.error || 'Fehler.', 'error');
  } catch { showDangerResult('Verbindungsfehler.', 'error'); }
};

window.dangerDeleteOrder = async function() {
  const pw = getDangerPw(); if (!pw) return;
  const id = document.getElementById('dangerOrderId').value;
  if (!id) { showDangerResult('Bitte eine Bestellungs-ID eingeben.', 'error'); return; }
  if (!confirm(`Bestellung #${id} unwiderruflich löschen?`)) return;
  try {
    const res  = await fetch(`/api/admin/danger/order/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dangerPassword: pw }) });
    const data = await res.json();
    if (res.ok) { showDangerResult(`✅ Bestellung #${id} gelöscht.`, 'success'); loadOrders(); loadStats(); loadDashUnpaid(); }
    else showDangerResult(data.error || 'Fehler.', 'error');
  } catch { showDangerResult('Verbindungsfehler.', 'error'); }
};

window.dangerDeletePayment = async function() {
  const pw = getDangerPw(); if (!pw) return;
  const id = document.getElementById('dangerPaymentId').value;
  if (!id) { showDangerResult('Bitte eine Zahlungs-ID eingeben.', 'error'); return; }
  if (!confirm(`Zahlung #${id} löschen? Falls zugeordnet, wird die Bestellung zurückgesetzt.`)) return;
  try {
    const res  = await fetch(`/api/admin/danger/payment/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dangerPassword: pw }) });
    const data = await res.json();
    if (res.ok) { showDangerResult(`✅ Zahlung #${id} gelöscht.`, 'success'); loadPayments(); loadStats(); loadOrders(); }
    else showDangerResult(data.error || 'Fehler.', 'error');
  } catch { showDangerResult('Verbindungsfehler.', 'error'); }
};

window.dangerNuclear = async function() {
  const pw = getDangerPw(); if (!pw) return;
  const confirm1 = document.getElementById('dangerNuclearConfirm').value.trim();
  if (confirm1 !== 'ALLES LÖSCHEN') { showDangerResult('Bestätigungstext stimmt nicht überein. Bitte genau "ALLES LÖSCHEN" eingeben.', 'error'); return; }
  if (!confirm('LETZTE WARNUNG: Wirklich ALLE Daten aus der Datenbank löschen?')) return;
  try {
    const res  = await fetch('/api/admin/danger/all', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dangerPassword: pw }) });
    const data = await res.json();
    if (res.ok) {
      showDangerResult('✅ Alle Daten wurden gelöscht.', 'success');
      document.getElementById('dangerNuclearConfirm').value = '';
      document.getElementById('dangerPwInput').value = '';
      loadStats(); loadPersons(); loadOrders(); loadPayments(); loadDashUnpaid();
    } else showDangerResult(data.error || 'Fehler.', 'error');
  } catch { showDangerResult('Verbindungsfehler.', 'error'); }
};
