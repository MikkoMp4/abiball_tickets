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
        showAdminContent();
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

  function showAdminContent() {
    overlay.style.display = 'none';
    content.style.display = 'block';
    initDashboard();
  }
})();

// ── Logout ──────────────────────────────────────────────────────────────
document.getElementById('logoutBtn')?.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.reload();
});

// ── Main init ─────────────────────────────────────────────────────────────
function initDashboard() {
  setupTabs();
  loadStats();
  loadDashUnpaid();
  loadOrders();
  loadPersons();
  loadPayments();
  loadSettings();
  setupSettingsSave();
  setupCsvUpload();
  setupPdfUpload();
  setupGenerateCodes();
  setupDangerZone();
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

// ── Helpers ────────────────────────────────────────────────────────────────
function showAlert(id, msg, type = 'danger') {
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
}
function clearAlert(id) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = '';
}
function fmt(eur) {
  return eur != null
    ? Number(eur).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
    : '–';
}
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function setBtn(id, disabled, html) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = disabled;
  btn.innerHTML = html;
}

// ── Stats ─────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const res  = await fetch('/api/admin/stats');
    if (res.status === 401) return;
    const data = await res.json();
    document.getElementById('st-persons').textContent     = data.totalPersons;
    document.getElementById('st-orders').textContent      = data.totalOrders;
    document.getElementById('st-paid').textContent        = data.paidOrders;
    document.getElementById('st-unpaid').textContent      = data.unpaidOrders;
    document.getElementById('st-tickets').textContent     = data.totalTickets;
    document.getElementById('st-revenue').textContent     = fmt(data.totalRevenue);
    document.getElementById('st-pending-rev').textContent = fmt(data.pendingRevenue);
    document.getElementById('st-payments').textContent    = `${data.matchedPayments} / ${data.totalPayments}`;
  } catch { /* silent */ }
}

async function loadDashUnpaid() {
  try {
    const res  = await fetch('/api/admin/orders');
    if (res.status === 401) return;
    const data = await res.json();
    const unpaid = (data.orders || []).filter(o => !o.paid);
    const tbody  = document.getElementById('dashUnpaidTbody');
    if (unpaid.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted)">Alle Bestellungen bezahlt 🎉</td></tr>';
      return;
    }
    tbody.innerHTML = unpaid.map(o => `
      <tr>
        <td><strong>${esc(o.person_name)}</strong></td>
        <td><code>${esc(o.person_code)}</code></td>
        <td>${o.ticket_count}</td>
        <td>${fmt(o.total_eur)}</td>
        <td style="font-size:.82rem;color:var(--muted)">${esc(o.created_at?.slice(0,16)||'')}</td>
      </tr>
    `).join('');
  } catch {
    showAlert('dashUnpaidAlert', 'Fehler beim Laden.');
  }
}

// ── Persons ─────────────────────────────────────────────────────────────
async function loadPersons() {
  try {
    const res  = await fetch('/api/admin/persons');
    if (res.status === 401) return;
    const data = await res.json();
    renderPersons(data.persons || []);
  } catch {
    showAlert('personsAlert', 'Fehler beim Laden der Personen.');
  }
}

function renderPersons(persons) {
  const tbody = document.getElementById('personsTbody');
  if (persons.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted)">Keine Personen vorhanden.</td></tr>';
    return;
  }
  tbody.innerHTML = persons.map(p => `
    <tr>
      <td><strong>${esc(p.name)}</strong></td>
      <td>${esc(p.email||'–')}</td>
      <td><code>${esc(p.code)}</code></td>
      <td>${p.num_tickets}</td>
      <td>${p.has_order?'<span class="badge badge-warning">Ja</span>':'<span class="badge badge-muted">Nein</span>'}</td>
      <td>${p.is_paid ?'<span class="badge badge-success">Bezahlt</span>':'<span class="badge badge-muted">Offen</span>'}</td>
      <td style="font-size:.82rem;color:var(--muted)">${esc(p.created_at?.slice(0,16)||'')}</td>
      <td><button class="btn btn-danger" style="padding:.3rem .7rem;font-size:.8rem" onclick="deletePerson(${p.id})">&#x1F5D1;</button></td>
    </tr>
  `).join('');
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
    if (!raw) { showAlert('genAlert','Bitte Personen eingeben.','warning'); return; }

    const persons = raw.split('\n').map(l=>l.trim()).filter(Boolean).map(line => {
      const parts = line.split(';').map(s=>s.trim());
      return { name: parts[0]||'Unbekannt', email: parts[1]||'', numTickets: parseInt(parts[2],10)||1 };
    });

    setBtn('generateBtn', true, '<span class="spinner"></span> Generiere…');
    try {
      const res  = await fetch('/api/admin/generate-codes', {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({persons}),
      });
      const data = await res.json();
      if (!res.ok) { showAlert('genAlert', data.error||'Fehler.'); return; }
      showAlert('genAlert', `✅ ${data.created.length} Code(s) generiert.`, 'success');
      document.getElementById('personsBulk').value = '';
      loadPersons(); loadStats();
    } catch { showAlert('genAlert','Verbindungsfehler.'); }
    finally   { setBtn('generateBtn', false, 'Codes generieren'); }
  });
}

// ── Orders ─────────────────────────────────────────────────────────────────
let allOrders = [];

async function loadOrders() {
  try {
    const res  = await fetch('/api/admin/orders');
    if (res.status === 401) return;
    const data = await res.json();
    allOrders  = data.orders || [];
    renderOrders(allOrders);
  } catch { showAlert('ordersAlert','Fehler beim Laden der Bestellungen.'); }
}

function renderOrders(orders) {
  const filter = document.getElementById('ordersFilter')?.value || 'all';
  let filtered = orders;
  if (filter==='paid')   filtered=orders.filter(o=>o.paid);
  if (filter==='unpaid') filtered=orders.filter(o=>!o.paid);
  if (filter==='sent')   filtered=orders.filter(o=>o.paid);

  const tbody = document.getElementById('ordersTbody');
  if (!filtered.length) {
    tbody.innerHTML='<tr><td colspan="8" style="text-align:center;color:var(--muted)">Keine Bestellungen vorhanden.</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(o => {
    const names = (o.tickets||[]).map(t=>esc(t.ticket_name)).join(', ')||'–';
    return `<tr>
      <td><strong>${esc(o.person_name)}</strong></td>
      <td style="font-size:.82rem">${esc(o.person_email||'–')}</td>
      <td><code>${esc(o.person_code)}</code></td>
      <td title="${names.replace(/"/g,'&quot;')}" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${o.ticket_count} (${names})</td>
      <td>${fmt(o.total_eur)}</td>
      <td>${o.paid
        ?`<span class="badge badge-success">✓ Bezahlt</span><br><span style="font-size:.75rem;color:var(--muted)">${esc(o.paid_at?.slice(0,16)||'')}</span>`
        :'<span class="badge badge-warning">Ausstehend</span>'}</td>
      <td style="font-size:.82rem;color:var(--muted)">${esc(o.created_at?.slice(0,16)||'')}</td>
      <td>${!o.paid?`<button class="btn btn-success" style="padding:.3rem .7rem;font-size:.8rem" onclick="markPaid(${o.id},this)">✓ Als bezahlt</button>`:''}</td>
    </tr>`;
  }).join('');
}

document.getElementById('ordersFilter')?.addEventListener('change',()=>renderOrders(allOrders));

window.markPaid = async function(orderId, btn) {
  if (!confirm('Bestellung manuell als bezahlt markieren?')) return;
  btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
  try {
    const res=await fetch(`/api/admin/orders/${orderId}/mark-paid`,{method:'POST'});
    const data=await res.json();
    if (res.ok) { loadOrders(); loadStats(); loadDashUnpaid(); }
    else { showAlert('ordersAlert',data.error||'Fehler.'); btn.disabled=false; btn.textContent='✓ Als bezahlt markieren'; }
  } catch { showAlert('ordersAlert','Verbindungsfehler.'); btn.disabled=false; btn.textContent='✓ Als bezahlt markieren'; }
};

// ── Payments ─────────────────────────────────────────────────────────────
async function loadPayments() {
  try {
    const res  = await fetch('/api/payments');
    const data = await res.json();
    renderPayments(data.payments||[]);
  } catch { showAlert('paymentsAlert','Fehler beim Laden der Zahlungen.'); }
}

function renderPayments(payments) {
  const tbody = document.getElementById('paymentsTbody');
  if (!payments.length) {
    tbody.innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--muted)">Keine Zahlungen vorhanden.</td></tr>';
    return;
  }
  tbody.innerHTML=payments.map(p=>`
    <tr>
      <td style="font-size:.82rem">${esc(p.booking_date||'–')}</td>
      <td>${esc(p.sender_name||'–')}</td>
      <td style="font-size:.82rem;max-width:200px;overflow:hidden;text-overflow:ellipsis">${esc(p.reference||'–')}</td>
      <td>${fmt(p.amount_eur)}</td>
      <td>${p.person_name?`<strong>${esc(p.person_name)}</strong>`:'<span style="color:var(--muted)">nicht zugeordnet</span>'}</td>
      <td>${p.matched?(p.qr_sent?'<span class="badge badge-success">QR gesendet</span>':'<span class="badge badge-warning">Zahlung ok</span>'):'<span class="badge badge-muted">offen</span>'}</td>
      <td>${p.matched&&!p.qr_sent?`<button class="btn btn-success" style="padding:.3rem .7rem;font-size:.8rem" onclick="sendTickets(${p.id},this)">✉ Tickets senden</button>`:''}</td>
    </tr>
  `).join('');
}

window.sendTickets = async function(paymentId, btn) {
  btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
  try {
    const res=await fetch(`/api/payments/${paymentId}/send`,{method:'POST'});
    const data=await res.json();
    if (res.ok) { showAlert('paymentsAlert',`✅ Tickets an ${data.sentTo} gesendet.`,'success'); loadPayments(); }
    else { showAlert('paymentsAlert',data.error||'Fehler.'); btn.disabled=false; btn.textContent='✉ Tickets senden'; }
  } catch { showAlert('paymentsAlert','Verbindungsfehler.'); btn.disabled=false; btn.textContent='✉ Tickets senden'; }
};

// ── PDF Upload ────────────────────────────────────────────────────────────
function setupPdfUpload() {
  document.getElementById('pdfUploadBtn')?.addEventListener('click', async () => {
    const fi = document.getElementById('pdfFiles');
    if (!fi.files.length) { showAlert('pdfUploadAlert','Bitte mindestens eine PDF auswählen.','warning'); return; }
    setBtn('pdfUploadBtn',true,'<span class="spinner"></span> Verarbeite PDFs…');
    clearAlert('pdfUploadAlert');
    document.getElementById('pdfResultCard').style.display='none';
    const form=new FormData();
    for (const f of fi.files) form.append('pdfs',f);
    try {
      const res=await fetch('/api/admin/upload-pdf',{method:'POST',body:form});
      const data=await res.json();
      if (res.ok) {
        showAlert('pdfUploadAlert',`✅ ${data.inserted||data.newlyPaid||0} neue Zahlung(en) importiert.`,'success');
        const rc=document.getElementById('pdfResultCard');
        rc.style.display='block';
        document.getElementById('pdfResultContent').innerHTML=
          `<p>Verarbeitet: <strong>${data.processed}</strong></p><p>Neu bezahlt: <strong>${data.newlyPaid}</strong></p>`;
        loadPayments(); loadStats(); loadOrders(); loadDashUnpaid();
      } else showAlert('pdfUploadAlert',data.error||'Fehler.');
    } catch { showAlert('pdfUploadAlert','Verbindungsfehler.'); }
    finally { setBtn('pdfUploadBtn',false,'📤 PDFs hochladen &amp; abgleichen'); }
  });
}

// ── CSV Upload ────────────────────────────────────────────────────────────
function setupCsvUpload() {
  document.getElementById('csvUploadBtn')?.addEventListener('click', async () => {
    const fi=document.getElementById('statementFile');
    if (!fi.files.length) { showAlert('csvUploadAlert','Bitte eine Datei auswählen.','warning'); return; }
    setBtn('csvUploadBtn',true,'<span class="spinner"></span> Verarbeite…');
    clearAlert('csvUploadAlert');
    const form=new FormData(); form.append('statement',fi.files[0]);
    try {
      const res=await fetch('/api/admin/upload-statement',{method:'POST',body:form});
      const data=await res.json();
      if (res.ok) {
        showAlert('csvUploadAlert',`✅ ${data.inserted} neue Zahlung(en), ${data.matched} zugeordnet.`,'success');
        loadPayments(); loadStats(); loadOrders(); loadDashUnpaid();
      } else showAlert('csvUploadAlert',data.error||'Fehler.');
    } catch { showAlert('csvUploadAlert','Verbindungsfehler.'); }
    finally { setBtn('csvUploadBtn',false,'Hochladen &amp; prüfen'); }
  });
}

// ── Settings ─────────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const res=await fetch('/api/admin/settings');
    if (res.status===401) return;
    const data=await res.json();
    const s=data.settings||{};
    document.getElementById('s-event-name').value     = s.event_name||'';
    document.getElementById('s-event-date').value     = s.event_date||'';
    document.getElementById('s-event-location').value = s.event_location||'';
    document.getElementById('s-ticket-price').value   = s.ticket_price||'';
    document.getElementById('s-bank-name').value      = s.bank_recipient||'';
    document.getElementById('s-bank-iban').value      = s.bank_iban||'';
    document.getElementById('s-bank-bic').value       = s.bank_bic||'';
    document.getElementById('settingsPreview').textContent = JSON.stringify(s,null,2);
    const envDiv=document.getElementById('envStatusContent');
    if (data.env) {
      envDiv.innerHTML=Object.entries(data.env).map(([k,v])=>
        `<div style="display:flex;justify-content:space-between;padding:.3rem 0;border-bottom:1px solid var(--border)">
          <code style="font-size:.85rem">${esc(k)}</code>
          <span class="badge ${v?'badge-success':'badge-muted'}">${v?'✅ Gesetzt':'❌ Nicht gesetzt'}</span>
        </div>`).join('');
    }
  } catch { /* silent */ }
}

function setupSettingsSave() {
  document.getElementById('saveEventBtn')?.addEventListener('click', async () => {
    clearAlert('settingsEventAlert');
    const body={
      event_name:     document.getElementById('s-event-name').value,
      event_date:     document.getElementById('s-event-date').value,
      event_location: document.getElementById('s-event-location').value,
      ticket_price:   parseFloat(document.getElementById('s-ticket-price').value)||null,
    };
    try {
      const res=await fetch('/api/admin/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if (res.ok) showAlert('settingsEventAlert','✅ Gespeichert.','success');
      else        showAlert('settingsEventAlert','Fehler beim Speichern.');
      loadSettings();
    } catch { showAlert('settingsEventAlert','Verbindungsfehler.'); }
  });

  document.getElementById('saveBankBtn')?.addEventListener('click', async () => {
    clearAlert('settingsBankAlert');
    const body={
      bank_recipient: document.getElementById('s-bank-name').value,
      bank_iban:      document.getElementById('s-bank-iban').value,
      bank_bic:       document.getElementById('s-bank-bic').value,
    };
    try {
      const res=await fetch('/api/admin/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if (res.ok) showAlert('settingsBankAlert','✅ Gespeichert.','success');
      else        showAlert('settingsBankAlert','Fehler beim Speichern.');
      loadSettings();
    } catch { showAlert('settingsBankAlert','Verbindungsfehler.'); }
  });
}

// ───────────────────────────────────────────────────────────────────────────────
// ⚠️  DANGER ZONE UI
// ───────────────────────────────────────────────────────────────────────────────
function setupDangerZone() {
  const panel     = document.getElementById('dangerPanel');
  const toggleBtn = document.getElementById('dangerToggleBtn');

  // Toggle visibility
  toggleBtn?.addEventListener('click', () => {
    const hidden = panel.style.display === 'none' || panel.style.display === '';
    panel.style.display = hidden ? 'block' : 'none';
    toggleBtn.textContent = hidden ? '▲ Danger Zone ausblenden' : '⚠️ Danger Zone öffnen';
  });

  // Helper: confirm + send danger request
  async function dangerRequest(url, confirmMsg, successMsg) {
    const pw = document.getElementById('dangerPassword').value;
    if (!pw) { showAlert('dangerAlert', 'Bitte Danger-Passwort eingeben.', 'warning'); return; }
    if (!confirm(confirmMsg)) return;

    try {
      const res  = await fetch(url, {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ dangerPassword: pw }),
      });
      const data = await res.json();
      if (res.ok) {
        showAlert('dangerAlert', `✅ ${successMsg}`, 'success');
        // Clear ID fields
        document.getElementById('dangerPersonId').value  = '';
        document.getElementById('dangerOrderId').value   = '';
        document.getElementById('dangerPaymentId').value = '';
        // Refresh all tables
        loadPersons(); loadOrders(); loadPayments(); loadStats(); loadDashUnpaid();
      } else {
        showAlert('dangerAlert', data.error || 'Fehler.');
      }
    } catch {
      showAlert('dangerAlert', 'Verbindungsfehler.');
    }
  }

  // Delete single person
  document.getElementById('dangerDeletePersonBtn')?.addEventListener('click', () => {
    const id = document.getElementById('dangerPersonId').value.trim();
    if (!id) { showAlert('dangerAlert', 'Bitte Personen-ID eingeben.', 'warning'); return; }
    dangerRequest(
      `/api/admin/danger/person/${id}`,
      `Person #${id} + alle zugehörigen Daten wirklich löschen? Das ist NICHT rückgängig zu machen!`,
      `Person #${id} und alle zugehörigen Daten gelöscht.`
    );
  });

  // Delete single order
  document.getElementById('dangerDeleteOrderBtn')?.addEventListener('click', () => {
    const id = document.getElementById('dangerOrderId').value.trim();
    if (!id) { showAlert('dangerAlert', 'Bitte Bestell-ID eingeben.', 'warning'); return; }
    dangerRequest(
      `/api/admin/danger/order/${id}`,
      `Bestellung #${id} wirklich löschen?`,
      `Bestellung #${id} gelöscht.`
    );
  });

  // Delete single payment
  document.getElementById('dangerDeletePaymentBtn')?.addEventListener('click', () => {
    const id = document.getElementById('dangerPaymentId').value.trim();
    if (!id) { showAlert('dangerAlert', 'Bitte Zahlungs-ID eingeben.', 'warning'); return; }
    dangerRequest(
      `/api/admin/danger/payment/${id}`,
      `Zahlung #${id} löschen? Zugehörige Bestellung wird auf \"unbezahlt\" zurückgesetzt.`,
      `Zahlung #${id} gelöscht.`
    );
  });

  // NUCLEAR: delete ALL
  document.getElementById('dangerDeleteAllBtn')?.addEventListener('click', () => {
    dangerRequest(
      '/api/admin/danger/all',
      '❗ ACHTUNG: ALLE Personen, Bestellungen und Zahlungen werden gelöscht! Wirklich fortfahren?',
      'Alle Daten wurden gelöscht.'
    );
  });
}
