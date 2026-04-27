/* admin.js – Admin-Dashboard */

// ── Tabs ─────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────
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

// ── Dashboard laden ───────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const res  = await fetch('/api/admin/stats');
    const data = await res.json();
    document.getElementById('st-persons').textContent     = data.totalPersons;
    document.getElementById('st-orders').textContent      = data.totalOrders;
    document.getElementById('st-paid').textContent        = data.paidOrders;
    document.getElementById('st-unpaid').textContent      = data.unpaidOrders;
    document.getElementById('st-tickets').textContent     = data.totalTickets;
    document.getElementById('st-revenue').textContent     = fmt(data.totalRevenue);
    document.getElementById('st-pending-rev').textContent = fmt(data.pendingRevenue);
    document.getElementById('st-payments').textContent    = `${data.matchedPayments} / ${data.totalPayments}`;
  } catch {
    // silent
  }
}

async function loadDashUnpaid() {
  try {
    const res  = await fetch('/api/admin/orders');
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
        <td style="font-size:.82rem;color:var(--muted)">${esc(o.created_at?.slice(0,16) || '')}</td>
      </tr>
    `).join('');
  } catch {
    showAlert('dashUnpaidAlert', 'Fehler beim Laden.');
  }
}

// ── Personen laden ────────────────────────────────────────────────────────────
async function loadPersons() {
  try {
    const res  = await fetch('/api/admin/persons');
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
      <td>${esc(p.email || '–')}</td>
      <td><code>${esc(p.code)}</code></td>
      <td>${p.num_tickets}</td>
      <td>${p.has_order ? '<span class="badge badge-warning">Ja</span>' : '<span class="badge badge-muted">Nein</span>'}</td>
      <td>${p.is_paid  ? '<span class="badge badge-success">Bezahlt</span>' : '<span class="badge badge-muted">Offen</span>'}</td>
      <td style="font-size:.82rem;color:var(--muted)">${esc(p.created_at?.slice(0,16) || '')}</td>
      <td>
        <button class="btn btn-danger" style="padding:.3rem .7rem;font-size:.8rem"
          onclick="deletePerson(${p.id})">🗑</button>
      </td>
    </tr>
  `).join('');
}

window.deletePerson = async function(id) {
  if (!confirm('Person und Code wirklich löschen?')) return;
  const res = await fetch(`/api/admin/persons/${id}`, { method: 'DELETE' });
  if (res.ok) { loadPersons(); loadStats(); }
  else showAlert('personsAlert', 'Fehler beim Löschen.');
};

// ── Codes generieren ──────────────────────────────────────────────────────────
document.getElementById('generateBtn').addEventListener('click', async () => {
  clearAlert('genAlert');
  const raw = document.getElementById('personsBulk').value.trim();
  if (!raw) { showAlert('genAlert', 'Bitte Personen eingeben.', 'warning'); return; }

  const lines   = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const persons = lines.map(line => {
    const parts = line.split(';').map(s => s.trim());
    return {
      name:       parts[0] || 'Unbekannt',
      email:      parts[1] || '',
      numTickets: parseInt(parts[2], 10) || 1,
    };
  });

  setBtn('generateBtn', true, '<span class="spinner"></span> Generiere…');

  try {
    const res  = await fetch('/api/admin/generate-codes', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ persons }),
    });
    const data = await res.json();
    if (!res.ok) { showAlert('genAlert', data.error || 'Fehler.'); return; }

    showAlert('genAlert', `✅ ${data.created.length} Code(s) erfolgreich generiert.`, 'success');
    document.getElementById('personsBulk').value = '';
    loadPersons();
    loadStats();
  } catch {
    showAlert('genAlert', 'Verbindungsfehler.');
  } finally {
    setBtn('generateBtn', false, 'Codes generieren');
  }
});

// ── Bestellungen laden ────────────────────────────────────────────────────────
let allOrders = [];

async function loadOrders() {
  try {
    const res  = await fetch('/api/admin/orders');
    const data = await res.json();
    allOrders  = data.orders || [];
    renderOrders(allOrders);
  } catch {
    showAlert('ordersAlert', 'Fehler beim Laden der Bestellungen.');
  }
}

function renderOrders(orders) {
  const filter = document.getElementById('ordersFilter')?.value || 'all';
  let filtered = orders;
  if (filter === 'paid')   filtered = orders.filter(o => o.paid);
  if (filter === 'unpaid') filtered = orders.filter(o => !o.paid);
  // 'sent' filter – check via payments table; approximate via paid && qr_sent
  if (filter === 'sent')   filtered = orders.filter(o => o.paid);

  const tbody = document.getElementById('ordersTbody');
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted)">Keine Bestellungen vorhanden.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(o => {
    const ticketNames = (o.tickets || []).map(t => esc(t.ticket_name)).join(', ') || '–';
    const ticketNamesAttr = (o.tickets || []).map(t => esc(t.ticket_name)).join(', ').replace(/"/g, '&quot;') || '–';
    return `
      <tr>
        <td><strong>${esc(o.person_name)}</strong></td>
        <td style="font-size:.82rem">${esc(o.person_email || '–')}</td>
        <td><code>${esc(o.person_code)}</code></td>
        <td title="${ticketNamesAttr}" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${o.ticket_count} (${ticketNames})</td>
        <td>${fmt(o.total_eur)}</td>
        <td>${o.paid
          ? `<span class="badge badge-success">✓ Bezahlt</span><br><span style="font-size:.75rem;color:var(--muted)">${esc(o.paid_at?.slice(0,16) || '')}</span>`
          : '<span class="badge badge-warning">Ausstehend</span>'}</td>
        <td style="font-size:.82rem;color:var(--muted)">${esc(o.created_at?.slice(0,16) || '')}</td>
        <td>
          ${!o.paid ? `<button class="btn btn-success" style="padding:.3rem .7rem;font-size:.8rem"
            onclick="markPaid(${o.id}, this)">✓ Als bezahlt markieren</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');
}

document.getElementById('ordersFilter').addEventListener('change', () => renderOrders(allOrders));

window.markPaid = async function(orderId, btn) {
  if (!confirm('Bestellung manuell als bezahlt markieren?')) return;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  try {
    const res  = await fetch(`/api/admin/orders/${orderId}/mark-paid`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      loadOrders();
      loadStats();
      loadDashUnpaid();
    } else {
      showAlert('ordersAlert', data.error || 'Fehler.');
      btn.disabled = false;
      btn.textContent = '✓ Als bezahlt markieren';
    }
  } catch {
    showAlert('ordersAlert', 'Verbindungsfehler.');
    btn.disabled = false;
    btn.textContent = '✓ Als bezahlt markieren';
  }
};

// ── Zahlungen laden ───────────────────────────────────────────────────────────
async function loadPayments() {
  try {
    const res  = await fetch('/api/payments');
    const data = await res.json();
    renderPayments(data.payments || []);
  } catch {
    showAlert('paymentsAlert', 'Fehler beim Laden der Zahlungen.');
  }
}

function renderPayments(payments) {
  const tbody = document.getElementById('paymentsTbody');
  if (payments.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted)">Keine Zahlungen vorhanden.</td></tr>';
    return;
  }
  tbody.innerHTML = payments.map(p => `
    <tr>
      <td style="font-size:.82rem">${esc(p.booking_date || '–')}</td>
      <td>${esc(p.sender_name || '–')}</td>
      <td style="font-size:.82rem;max-width:200px;overflow:hidden;text-overflow:ellipsis">${esc(p.reference || '–')}</td>
      <td>${fmt(p.amount_eur)}</td>
      <td>${p.person_name ? `<strong>${esc(p.person_name)}</strong>` : '<span style="color:var(--muted)">nicht zugeordnet</span>'}</td>
      <td>
        ${p.matched
          ? (p.qr_sent
              ? '<span class="badge badge-success">QR gesendet</span>'
              : '<span class="badge badge-warning">Zahlung ok</span>')
          : '<span class="badge badge-muted">offen</span>'}
      </td>
      <td>
        ${p.matched && !p.qr_sent
          ? `<button class="btn btn-success" style="padding:.3rem .7rem;font-size:.8rem"
               onclick="sendTickets(${p.id}, this)">✉ Tickets senden</button>`
          : ''}
      </td>
    </tr>
  `).join('');
}

window.sendTickets = async function(paymentId, btn) {
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  try {
    const res  = await fetch(`/api/payments/${paymentId}/send`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      showAlert('paymentsAlert', `✅ Tickets an ${data.sentTo} gesendet.`, 'success');
      loadPayments();
    } else {
      showAlert('paymentsAlert', data.error || 'Fehler beim Senden.');
      btn.disabled = false;
      btn.textContent = '✉ Tickets senden';
    }
  } catch {
    showAlert('paymentsAlert', 'Verbindungsfehler.');
    btn.disabled = false;
    btn.textContent = '✉ Tickets senden';
  }
};

// ── PDF hochladen ─────────────────────────────────────────────────────────────
document.getElementById('pdfUploadBtn').addEventListener('click', async () => {
  const fileInput = document.getElementById('pdfFiles');
  if (!fileInput.files.length) {
    showAlert('pdfUploadAlert', 'Bitte mindestens eine PDF-Datei auswählen.', 'warning');
    return;
  }

  setBtn('pdfUploadBtn', true, '<span class="spinner"></span> Verarbeite PDFs…');
  clearAlert('pdfUploadAlert');
  document.getElementById('pdfResultCard').style.display = 'none';

  const form = new FormData();
  for (const f of fileInput.files) form.append('pdfs', f);

  try {
    const res  = await fetch('/api/admin/upload-pdf', { method: 'POST', body: form });
    const data = await res.json();

    if (!res.ok) { showAlert('pdfUploadAlert', data.error || 'Fehler.'); return; }

    showAlert('pdfUploadAlert',
      `✅ ${data.processed} Einträge gefunden, <strong>${data.newlyPaid}</strong> Bestellung(en) als bezahlt markiert.`,
      data.newlyPaid > 0 ? 'success' : 'info'
    );
    fileInput.value = '';

    // Ergebnis anzeigen
    if (data.results && data.results.length > 0) {
      renderPdfResults(data.results);
      document.getElementById('pdfResultCard').style.display = 'block';
    }

    loadPayments();
    loadOrders();
    loadStats();
    loadDashUnpaid();
  } catch {
    showAlert('pdfUploadAlert', 'Verbindungsfehler.');
  } finally {
    setBtn('pdfUploadBtn', false, '📤 PDFs hochladen &amp; abgleichen');
  }
});

function renderPdfResults(results) {
  const container = document.getElementById('pdfResultContent');
  const rows = results.map(r => {
    if (r.error) {
      return `<tr><td>${esc(r.file)}</td><td colspan="5" style="color:var(--danger)">${esc(r.error)}</td></tr>`;
    }
    let statusBadge;
    if (r.markedPaid)       statusBadge = '<span class="badge badge-success">✓ Als bezahlt markiert</span>';
    else if (r.alreadyPaid) statusBadge = '<span class="badge badge-warning">Bereits bezahlt</span>';
    else if (r.personName)  statusBadge = '<span class="badge badge-danger">Betrag stimmt nicht</span>';
    else                    statusBadge = '<span class="badge badge-muted">Person nicht gefunden</span>';

    return `<tr>
      <td style="font-size:.82rem">${esc(r.file)}</td>
      <td><code>${esc(r.reference)}</code></td>
      <td>${r.personName ? esc(r.personName) : '<span style="color:var(--muted)">–</span>'}</td>
      <td>${r.amount != null ? fmt(r.amount) : '–'}</td>
      <td>${r.expectedAmount != null ? fmt(r.expectedAmount) : '–'}</td>
      <td>${statusBadge}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div style="overflow-x:auto">
      <table>
        <thead>
          <tr><th>Datei</th><th>Referenz</th><th>Person</th><th>Gefundener Betrag</th><th>Erwarteter Betrag</th><th>Ergebnis</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ── CSV hochladen ─────────────────────────────────────────────────────────────
document.getElementById('csvUploadBtn').addEventListener('click', async () => {
  const fileInput = document.getElementById('statementFile');
  if (!fileInput.files.length) {
    showAlert('csvUploadAlert', 'Bitte eine CSV-Datei auswählen.', 'warning');
    return;
  }

  setBtn('csvUploadBtn', true, '<span class="spinner"></span> Verarbeite…');
  clearAlert('csvUploadAlert');

  const form = new FormData();
  form.append('statement', fileInput.files[0]);

  try {
    const res  = await fetch('/api/payments/upload', { method: 'POST', body: form });
    const data = await res.json();

    if (!res.ok) { showAlert('csvUploadAlert', data.error || 'Fehler.'); return; }

    const matched = data.results.filter(r => r.matched).length;
    showAlert('csvUploadAlert',
      `✅ ${data.processed} Buchungen eingelesen, ${matched} Zahlungen zugeordnet.`,
      'success'
    );
    fileInput.value = '';
    loadPayments();
    loadStats();
  } catch {
    showAlert('csvUploadAlert', 'Verbindungsfehler.');
  } finally {
    setBtn('csvUploadBtn', false, 'Hochladen &amp; prüfen');
  }
});

// ── Einstellungen laden / speichern ───────────────────────────────────────────
async function loadSettings() {
  try {
    const res  = await fetch('/api/admin/settings');
    const data = await res.json();
    applySettingsToForm(data.settings || {});
    updateSettingsPreview(data.settings || {});
  } catch {
    // silent
  }
}

function applySettingsToForm(s) {
  const set = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.value = val; };
  set('s-event-name',     s.event_name);
  set('s-event-date',     s.event_date);
  set('s-event-location', s.event_location);
  set('s-ticket-price',   s.ticket_price);
  set('s-bank-name',      s.bank_name);
  set('s-bank-iban',      s.bank_iban);
  set('s-bank-bic',       s.bank_bic);
}

function updateSettingsPreview(s) {
  document.getElementById('settingsPreview').textContent = JSON.stringify(s, null, 2);
}

async function saveSettings(keys, alertId, btnId, btnLabel) {
  const body = {};
  keys.forEach(([domId, key]) => {
    const el = document.getElementById(domId);
    if (el) body[key] = el.value.trim();
  });

  setBtn(btnId, true, '<span class="spinner"></span> Speichern…');
  clearAlert(alertId);

  try {
    const res  = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { showAlert(alertId, data.error || 'Fehler.'); return; }
    showAlert(alertId, '✅ Gespeichert.', 'success');
    updateSettingsPreview(data.settings || {});
  } catch {
    showAlert(alertId, 'Verbindungsfehler.');
  } finally {
    setBtn(btnId, false, btnLabel);
  }
}

document.getElementById('saveEventBtn').addEventListener('click', () =>
  saveSettings(
    [
      ['s-event-name',     'event_name'],
      ['s-event-date',     'event_date'],
      ['s-event-location', 'event_location'],
      ['s-ticket-price',   'ticket_price'],
    ],
    'settingsEventAlert', 'saveEventBtn', '💾 Veranstaltungsdaten speichern'
  )
);

document.getElementById('saveBankBtn').addEventListener('click', () =>
  saveSettings(
    [
      ['s-bank-name', 'bank_name'],
      ['s-bank-iban', 'bank_iban'],
      ['s-bank-bic',  'bank_bic'],
    ],
    'settingsBankAlert', 'saveBankBtn', '💾 Bankdaten speichern'
  )
);

// ── Start ─────────────────────────────────────────────────────────────────────
loadStats();
loadDashUnpaid();
loadPersons();
loadPayments();
loadOrders();
loadSettings();
