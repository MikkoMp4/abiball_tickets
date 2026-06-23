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
  setupEmailSend();
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

function splitTicketBadge(ticket) {
  if (ticket.ticket_paid) return `<span class="badge badge-success" style="font-size:.7rem">✓ Bezahlt</span>`;
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
  if (filter === 'sent')    filtered = orders.filter(o => o.qr_sent);

  const tbody = document.getElementById('ordersTbody');
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted)">Keine Bestellungen vorhanden.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(o => {
    const ticketCount = (o.tickets || []).length;
    const paidCount   = (o.tickets || []).filter(t => t.ticket_paid).length;
    const splitIcon   = o.split_payment ? ' 💳' : '';

    let markPaidBtn = '';
    if (o.paid !== 1) {
      const remaining = o.paid === 2
        ? fmt((parseFloat(o.total_eur) || 0) - (parseFloat(o.paid_amount) || 0))
        : fmt(o.total_eur);
      const label = o.paid === 2
        ? `✓ Restbetrag (${remaining}) bezahlt`
        : `✓ Alles bezahlt`;
      markPaidBtn = `<button class="btn btn-success" style="padding:.25rem .6rem;font-size:.78rem;white-space:nowrap" onclick="event.stopPropagation();markPaid(${o.id},this)">${label}</button>`;
    }

    const ticketRows = (o.tickets || []).map((t, i) => {
      const splitRef = o.split_payment && t.split_ref
        ? `<code style="font-size:.7rem;color:var(--muted);display:block">${esc(t.split_ref)}</code>`
        : '';
      const statusBadge = o.split_payment ? splitTicketBadge(t) : '';

      const canMarkPaid = !t.ticket_paid && o.paid !== 1;
      const ticketPaidBtn = canMarkPaid
        ? `<button class="btn btn-success" style="padding:.18rem .4rem;font-size:.72rem;white-space:nowrap" onclick="adminMarkTicketPaid(${o.id},${t.id},this)" title="Ticket als bezahlt markieren">✓ bezahlt</button>`
        : '';
      const deleteBtn = canMarkPaid
        ? `<button class="btn btn-danger" style="padding:.18rem .4rem;font-size:.72rem" onclick="adminDeleteTicket(${o.id},${t.id},this)">🗑</button>`
        : (t.ticket_paid ? `<span class="badge badge-success" style="font-size:.7rem">✓</span>` : '');

      return `
        <div style="display:flex;align-items:center;gap:.4rem;padding:.3rem .5rem;border-bottom:1px solid #f0f0f0;flex-wrap:wrap;background:#fafafa">
          <span style="font-size:.78rem;color:#999;min-width:1.8rem">T${i+1}</span>
          <span style="flex:1;font-size:.83rem;min-width:120px">
            <strong>${esc(t.ticket_name)}</strong>
            <span style="color:var(--muted)"> &lt;${esc(t.ticket_email || '–')}&gt;</span>
            ${splitRef}
          </span>
          ${statusBadge}
          ${ticketPaidBtn}
          ${deleteBtn}
        </div>`;
    }).join('');

    const detailId = `order-detail-${o.id}`;

    const summaryRow = `
      <tr class="order-summary-row" onclick="toggleOrderDetail('${detailId}', this)"
          style="cursor:pointer;user-select:none" title="Klicken zum Aufklappen">
        <td style="width:1.8rem">
          <span class="order-chevron" style="display:inline-block;transition:transform .18s">▶</span>
        </td>
        <td><span class="badge badge-muted">#${o.id}</span></td>
        <td><strong>${esc(o.person_name)}</strong><br><code style="font-size:.75rem">${esc(o.person_code)}</code></td>
        <td style="font-size:.83rem">${ticketCount} Ticket(s)${o.split_payment ? ' <span title="Splitbuchung" style="font-size:.8rem">💳</span>' : ''}
          ${o.split_payment ? `<br><span style="font-size:.72rem;color:var(--muted)">${paidCount}/${ticketCount} bezahlt</span>` : ''}
        </td>
        <td>${fmt(o.total_eur)}${splitIcon}</td>
        <td>${paidBadge(o)}</td>
        <td style="font-size:.78rem;color:var(--muted)">${esc(o.created_at?.slice(0,16)||'')}</td>
        <td onclick="event.stopPropagation()">${markPaidBtn}</td>
      </tr>`;

    const detailRow = `
      <tr id="${detailId}" style="display:none">
        <td colspan="8" style="padding:0;border-top:none">
          <div style="border-left:3px solid #e0e0e0;margin-left:.5rem">
            ${ticketRows || '<div style="padding:.5rem 1rem;color:var(--muted);font-size:.85rem">Keine Tickets.</div>'}
          </div>
        </td>
      </tr>`;

    return summaryRow + detailRow;
  }).join('');
}

window.toggleOrderDetail = function(detailId, summaryRow) {
  const detail  = document.getElementById(detailId);
  const chevron = summaryRow.querySelector('.order-chevron');
  if (!detail) return;
  const isOpen = detail.style.display !== 'none';
  detail.style.display = isOpen ? 'none' : 'table-row';
  if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(90deg)';
};

document.getElementById('ordersFilter')?.addEventListener('change', () => renderOrders(allOrders));

// ── Mark entire order as paid ──────────────────────────────────────────────
window.markPaid = async function(orderId, btn) {
  if (!confirm('Bestellung manuell als vollständig bezahlt markieren?')) return;
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    const res  = await fetch(`/api/admin/orders/${orderId}/mark-paid`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) { loadOrders(); loadStats(); loadDashUnpaid(); }
    else { showAlert('ordersAlert', data.error || 'Fehler.'); btn.disabled = false; btn.textContent = '✓ Als bezahlt markieren'; }
  } catch { showAlert('ordersAlert', 'Verbindungsfehler.'); btn.disabled = false; btn.textContent = '✓ Als bezahlt markieren'; }
};

// ── Mark single ticket as paid ──────────────────────────────────────────────
window.adminMarkTicketPaid = async function(orderId, ticketId, btn) {
  if (!confirm('Dieses Ticket als bezahlt markieren?')) return;
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    const res  = await fetch(`/api/admin/orders/${orderId}/ticket/${ticketId}/mark-paid`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      const emailInfo = data.email?.ok
        ? ` E-Mail an ${esc(data.email.sentTo)}.`
        : (data.email?.error ? ` ⚠️ E-Mail fehlgeschlagen.` : '');
      showAlert('ordersAlert', `✅ Ticket bezahlt markiert.${emailInfo}`, 'success');
      loadOrders(); loadStats(); loadDashUnpaid();
    } else {
      showAlert('ordersAlert', data.error || 'Fehler.');
      btn.disabled = false; btn.textContent = '✓ bezahlt';
    }
  } catch {
    showAlert('ordersAlert', 'Verbindungsfehler.');
    btn.disabled = false; btn.textContent = '✓ bezahlt';
  }
};

window.adminDeleteTicket = async function(orderId, ticketId, btn) {
  if (!confirm('Dieses Ticket wirklich löschen?')) return;
  btn.disabled = true; btn.innerHTML = '…';
  try {
    const res  = await fetch(`/api/admin/orders/${orderId}/ticket/${ticketId}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok) {
      showAlert('ordersAlert', `✅ Ticket gelöscht. Neuer Betrag: ${fmt(data.newTotalEur)}`, 'success');
      loadOrders(); loadStats();
    } else if (data.error === 'paid_order') {
      showAlert('ordersAlert', '⚠️ Bestellung bereits bezahlt → Danger Zone verwenden.', 'warning');
      btn.disabled = false; btn.innerHTML = '🗑';
    } else if (data.error === 'last_ticket') {
      showAlert('ordersAlert', '⚠️ Mindestens ein Ticket muss verbleiben.', 'warning');
      btn.disabled = false; btn.innerHTML = '🗑';
    } else {
      showAlert('ordersAlert', data.message || data.error || 'Fehler.');
      btn.disabled = false; btn.innerHTML = '🗑';
    }
  } catch {
    showAlert('ordersAlert', 'Verbindungsfehler.');
    btn.disabled = false; btn.innerHTML = '🗑';
  }
};

// ── Payments ────────────────────────────────────────────────────────────────
let allPersonsForPayments = [];

async function loadPayments() {
  try {
    const pRes = await fetch('/api/admin/persons');
    if (pRes.ok) {
      const pData = await pRes.json();
      allPersonsForPayments = pData.persons || [];
    }
    const res  = await fetch('/api/payments');
    const data = await res.json();
    renderPayments(data.payments || []);
  } catch { showAlert('paymentsAlert', 'Fehler beim Laden der Zahlungen.'); }
}

function renderPayments(payments) {
  const tbody = document.getElementById('paymentsTbody');
  if (!payments.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--muted)">Keine Zahlungen vorhanden.</td></tr>';
    return;
  }

  const personOptions = allPersonsForPayments
    .map(p => `<option value="${p.id}">${esc(p.name)} (${esc(p.code)})</option>`)
    .join('');

  tbody.innerHTML = payments.map(p => {
    let assignCell;
    if (!p.matched || !p.person_id) {
      assignCell = `
        <div style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap">
          <select id="assign-select-${p.id}" style="font-size:.8rem;padding:.2rem .4rem;border:1px solid var(--border);border-radius:4px;max-width:160px">
            <option value="">– Person –</option>
            ${personOptions}
          </select>
          <button class="btn btn-primary" style="padding:.25rem .6rem;font-size:.78rem;white-space:nowrap"
            onclick="assignPayment(${p.id},this)">Zuordnen</button>
        </div>`;
    } else {
      assignCell = `<strong>${esc(p.person_name)}</strong>
        <button class="btn" style="padding:.15rem .45rem;font-size:.72rem;margin-left:.4rem;background:none;border:1px solid var(--border);color:var(--muted)"
          onclick="reassignPayment(${p.id},this)" title="Zuordnung ändern">✏️</button>`;
    }

    const statusBadge = p.matched
      ? (p.qr_sent
          ? '<span class="badge badge-success">QR gesendet</span>'
          : '<span class="badge badge-warning">Zahlung ok</span>')
      : '<span class="badge badge-muted">offen</span>';

    const sendBtn = p.matched && p.person_id && !p.qr_sent
      ? `<button class="btn btn-success" style="padding:.3rem .7rem;font-size:.8rem" onclick="sendTickets(${p.id},this)">✉ Tickets senden</button>`
      : '';

    return `<tr>
      <td><span class="badge badge-muted" title="Zahlungs-ID">#${p.id}</span></td>
      <td style="font-size:.82rem">${esc(p.booking_date||'–')}</td>
      <td>${esc(p.sender_name||'–')}</td>
      <td style="font-size:.82rem;max-width:180px;overflow:hidden;text-overflow:ellipsis">${esc(p.reference||'–')}</td>
      <td>${fmt(p.amount_eur)}</td>
      <td>${assignCell}</td>
      <td>${statusBadge}</td>
      <td>${sendBtn}</td>
    </tr>`;
  }).join('');
}

/** Zahlung einer Person zuordnen */
window.assignPayment = async function(paymentId, btn) {
  const select   = document.getElementById(`assign-select-${paymentId}`);
  const personId = select?.value;
  if (!personId) { showAlert('paymentsAlert', 'Bitte eine Person auswählen.', 'warning'); return; }
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    const res  = await fetch(`/api/payments/${paymentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personId: Number(personId) }),
    });
    const data = await res.json();
    if (res.ok) {
      // Zeige detaillierte Debug-Info aus der Antwort
      let msg = `✅ Zahlung ${paymentId} zugeordnet zu ${esc(data.personName)}.`;
      if (data.nowFullyPaid) {
        msg += ' 🎉 Bestellung jetzt vollständig bezahlt!';
      } else if (data.orderPaidStatus === 2) {
        msg += ` Teilzahlung: ${fmt(data.orderPaidAmount)} von ${fmt(data.orderTotalEur)}.`;
      } else if (data.orderTotalEur === 0 || data.orderTotalEur === null) {
        msg += ' ⚠️ Bestellung hat total_eur=0 – Betrag wurde nicht automatisch gesetzt. Bitte manuell als bezahlt markieren.';
      } else {
        msg += ` Bestellstatus: ${data.orderPaidStatus} (${fmt(data.orderPaidAmount)} von ${fmt(data.orderTotalEur)}).`;
      }
      showAlert('paymentsAlert', msg, data.nowFullyPaid ? 'success' : 'warning');
      loadPayments(); loadOrders(); loadStats(); loadDashUnpaid();
    } else {
      showAlert('paymentsAlert', data.error || 'Fehler beim Zuordnen.');
      btn.disabled = false; btn.textContent = 'Zuordnen';
    }
  } catch {
    showAlert('paymentsAlert', 'Verbindungsfehler.');
    btn.disabled = false; btn.textContent = 'Zuordnen';
  }
};

/** Zuordnung ändern */
window.reassignPayment = async function(paymentId, btn) {
  const personOptions = allPersonsForPayments
    .map(p => `<option value="${p.id}">${esc(p.name)} (${esc(p.code)})</option>`)
    .join('');
  const cell = btn.parentElement;
  cell.innerHTML = `
    <div style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap">
      <select id="assign-select-${paymentId}" style="font-size:.8rem;padding:.2rem .4rem;border:1px solid var(--border);border-radius:4px;max-width:160px">
        <option value="">– Person –</option>
        ${personOptions}
      </select>
      <button class="btn btn-primary" style="padding:.25rem .6rem;font-size:.78rem;white-space:nowrap"
        onclick="assignPayment(${paymentId},this)">Speichern</button>
      <button class="btn" style="padding:.25rem .5rem;font-size:.78rem"
        onclick="loadPayments()">✕</button>
    </div>`;
};

window.sendTickets = async function(paymentId, btn) {
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    const res  = await fetch(`/api/payments/${paymentId}/send`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) { showAlert('paymentsAlert', `✅ Tickets an ${(data.sentTo||[]).join(', ')} gesendet.`, 'success'); loadPayments(); }
    else { showAlert('paymentsAlert', data.error || 'Fehler.'); btn.disabled = false; btn.textContent = '✉ Tickets senden'; }
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
        const processed = data.processed ?? 0;
        const matched   = data.matched ?? 0;
        let msg = `✅ ${processed} Zeilen verarbeitet, ${matched} zugeordnet.`;
        if (data.newlyPaid > 0) msg += ` 🎉 ${data.newlyPaid} Bestellung(en) jetzt vollständig bezahlt.`;
        // Detail-Tabelle der Ergebnisse
        let detail = '';
        if (data.results?.length) {
          const rows = data.results.slice(0, 20).map(r =>
            `<tr>
              <td style="font-size:.75rem;max-width:160px;overflow:hidden;text-overflow:ellipsis">${esc(r.reference)}</td>
              <td style="font-size:.75rem">${fmt(r.amount)}</td>
              <td style="font-size:.75rem">${r.personName ? esc(r.personName) : '<span style="color:var(--muted)">–</span>'}</td>
              <td style="font-size:.75rem">${r.orderId ? `#${r.orderId} (${fmt(r.orderTotalEur)})` : '<span style="color:var(--muted)">–</span>'}</td>
              <td>${r.matched ? '✅' : '❌'}</td>
            </tr>`
          ).join('');
          detail = `<details style="margin-top:.5rem"><summary style="cursor:pointer;font-size:.83rem">Details (${data.results.length} Zeilen)</summary>
            <table style="width:100%;font-size:.8rem;margin-top:.3rem">
              <thead><tr><th>Referenz</th><th>Betrag</th><th>Person</th><th>Bestellung</th><th>Match</th></tr></thead>
              <tbody>${rows}</tbody>
            </table></details>`;
        }
        showAlert('csvUploadAlert', msg + detail, 'success');
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
    document.getElementById('s-bank-name').value      = s.bank_name      || '';
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
    const body = {
      event_name:     document.getElementById('s-event-name').value,
      event_date:     document.getElementById('s-event-date').value,
      event_location: document.getElementById('s-event-location').value,
      ticket_price:   parseFloat(document.getElementById('s-ticket-price').value) || null,
    };
    try {
      const res = await fetch('/api/admin/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) showAlert('settingsEventAlert', '✅ Gespeichert.', 'success');
      else        showAlert('settingsEventAlert', 'Fehler beim Speichern.');
      loadSettings();
    } catch { showAlert('settingsEventAlert', 'Verbindungsfehler.'); }
  });
  document.getElementById('saveBankBtn')?.addEventListener('click', async () => {
    clearAlert('settingsBankAlert');
    const body = {
      bank_name: document.getElementById('s-bank-name').value,
      bank_iban: document.getElementById('s-bank-iban').value,
      bank_bic:  document.getElementById('s-bank-bic').value,
    };
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

// ── Mass e-mail send ─────────────────────────────────────────────────────────
function setupEmailSend() {
  document.getElementById('sendAllTicketsBtn')
    ?.addEventListener('click', () => startEmailSend(null));

  document.getElementById('testEmailBtn')
    ?.addEventListener('click', () => {
      const email = (document.getElementById('testEmailInput')?.value || '').trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showAlert('emailSendAlert', 'Bitte eine gültige E-Mail-Adresse für den Test eingeben.', 'warning');
        return;
      }
      startEmailSend(email);
    });

  document.getElementById('loadPreviewBtn')
    ?.addEventListener('click', loadBulkPreview);
}

// ── Empfängerliste laden & Checkliste ────────────────────────────────────────
async function loadBulkPreview() {
  const btn    = document.getElementById('loadPreviewBtn');
  const status = document.getElementById('previewStatus');
  const panel  = document.getElementById('bulkPreviewPanel');
  const list   = document.getElementById('bulkPreviewList');

  btn.disabled  = true;
  btn.innerHTML = '<span class="spinner"></span> Lade…';
  status.textContent = '';

  try {
    const res  = await fetch('/api/admin/bulk-email-preview');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    const recipients = data.recipients || [];

    list.innerHTML = recipients.map(r => `
      <label style="display:flex;align-items:center;gap:.55rem;padding:.28rem .75rem;
                    border-bottom:1px solid #f0f0f0;cursor:pointer;line-height:1.4"
             onmouseover="this.style.background='#f8f8f8'"
             onmouseout="this.style.background=''">
        <input type="checkbox" class="bulk-recipient-check"
               data-order-id="${r.orderId}" data-pos="${r.position}"
               checked style="accent-color:var(--primary);cursor:pointer;flex-shrink:0">
        <span style="color:#bbb;min-width:2.4rem;font-size:.75rem">#${r.position}</span>
        <span style="flex:1;font-weight:500">${esc(r.name)}</span>
        <span style="color:#777">${esc(r.email)}</span>
      </label>
    `).join('');

    panel.style.display = 'block';
    _updatePreviewCounts();

    // Zähler live updaten beim An-/Abhaken
    list.addEventListener('change', _updatePreviewCounts);

  } catch (e) {
    status.textContent = `❌ Fehler: ${e.message}`;
  } finally {
    btn.disabled  = false;
    btn.innerHTML = '🔄 Liste neu laden';
  }
}

function _updatePreviewCounts() {
  const total   = document.querySelectorAll('.bulk-recipient-check').length;
  const checked = document.querySelectorAll('.bulk-recipient-check:checked').length;
  const countEl = document.getElementById('previewCountLabel');
  const sendBtn = document.getElementById('sendAllTicketsBtn');

  if (countEl) countEl.textContent = `${checked} von ${total} ausgewählt`;
  if (sendBtn && total > 0) {
    sendBtn.innerHTML = `📤 ${checked} Ticket-Mail(s) versenden`;
  }
}

// "Senden ab #N" – alles VOR N abwählen, ab N auswählen
window.applySkipFrom = function () {
  const from = parseInt(document.getElementById('skipFromInput').value, 10);
  if (!from || from < 1) return;
  document.querySelectorAll('.bulk-recipient-check').forEach(cb => {
    cb.checked = parseInt(cb.dataset.pos, 10) >= from;
  });
  _updatePreviewCounts();
};

// Alle an- oder abwählen
window.selectAllRecipients = function (checked) {
  document.querySelectorAll('.bulk-recipient-check').forEach(cb => { cb.checked = checked; });
  _updatePreviewCounts();
};

// ── Versand starten (SSE) ────────────────────────────────────────────────────
async function startEmailSend(testEmail) {
  const isTest = !!testEmail;

  // Buttons sperren
  setBtn('sendAllTicketsBtn', true, '<span class="spinner"></span> Sende…');
  setBtn('testEmailBtn',      true, '<span class="spinner"></span>');
  clearAlert('emailSendAlert');

  // Progress UI zurücksetzen
  const progressWrap = document.getElementById('emailSendProgress');
  const bar          = document.getElementById('emailProgressBar');
  const label        = document.getElementById('emailProgressLabel');
  const counter      = document.getElementById('emailProgressCount');
  const log          = document.getElementById('emailProgressLog');

  progressWrap.style.display = 'block';
  bar.style.width             = '0%';
  bar.style.background        = 'linear-gradient(90deg,var(--primary),var(--primary-dark))';
  label.textContent           = 'Vorbereitung…';
  counter.textContent         = '0 / ?';
  log.innerHTML               = '';

  const logLine = (text, color) => {
    const div       = document.createElement('div');
    div.style.color = color || '#333';
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop   = log.scrollHeight;
  };

  try {
    const attachQr = document.getElementById('attachQrCheck')?.checked ?? true;

    // Welche Order-IDs sollen übersprungen werden? (abgehakte Checkboxen = nicht checked)
    const skipOrderIds = [];
    document.querySelectorAll('.bulk-recipient-check:not(:checked)').forEach(cb => {
      skipOrderIds.push(Number(cb.dataset.orderId));
    });

    const response = await fetch('/api/admin/send-all-tickets', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        testEmail:    testEmail || null,
        attachQr,
        skipOrderIds: skipOrderIds.length > 0 ? skipOrderIds : [],
      }),
    });

    if (!response.ok) {
      const d = await response.json().catch(() => ({}));
      showAlert('emailSendAlert', d.error || `HTTP-Fehler ${response.status}`, 'danger');
      return;
    }

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });

      const parts = buf.split('\n\n');
      buf = parts.pop();

      for (const block of parts) {
        const dataLine = block.split('\n').find(l => l.startsWith('data: '));
        if (!dataLine) continue;

        let evt;
        try { evt = JSON.parse(dataLine.slice(6)); }
        catch { continue; }

        if (evt.error && !evt.done) {
          logLine(`⚠️ ${evt.error}`, '#dc2626');
          continue;
        }

        if (typeof evt.total === 'number' && !evt.done) {
          counter.textContent = `${evt.sent} / ${evt.total}`;
          const pct = evt.total > 0 ? Math.round((evt.sent / evt.total) * 100) : 0;
          bar.style.width     = `${pct}%`;

          if (evt.status === 'sending') {
            label.textContent = `Sende an ${esc(evt.current)}…`;
          } else if (evt.status === 'ok') {
            label.textContent = `✓ ${esc(evt.current)}`;
            logLine(`✅ ${evt.current}`, '#166534');
          } else if (evt.status === 'error') {
            logLine(`❌ ${evt.current} — ${evt.error || 'Fehler'}`, '#dc2626');
          }
        }

        if (evt.done) {
          counter.textContent = `${evt.sent} / ${evt.total}`;
          bar.style.width     = '100%';

          if (evt.total === 0) {
            label.textContent = 'Keine bezahlten Tickets gefunden.';
            showAlert('emailSendAlert',
              'Keine bezahlten Tickets mit E-Mail-Adresse vorhanden.', 'warning');

          } else if (evt.failed > 0) {
            bar.style.background = 'linear-gradient(90deg,#f59e0b,#d97706)';
            label.textContent    = `Fertig — ${evt.failed} Fehler`;
            showAlert('emailSendAlert',
              `${evt.sent} E-Mail(s) gesendet, ${evt.failed} fehlgeschlagen. Details im Log.`,
              'warning');

          } else {
            bar.style.background = '#2e7d32';
            label.textContent    = isTest ? '✓ Test-E-Mail gesendet' : '✓ Alle E-Mails gesendet';
            showAlert('emailSendAlert',
              isTest
                ? `Test-E-Mail erfolgreich an ${esc(testEmail)} gesendet.`
                : `${evt.sent} Ticket-E-Mail(s) erfolgreich versendet.`,
              'success');
          }
        }
      }
    }

  } catch (err) {
    showAlert('emailSendAlert', `Verbindungsfehler: ${esc(err.message)}`, 'danger');
    logLine(`❌ Verbindungsfehler: ${err.message}`, '#dc2626');
  } finally {
    const checked = document.querySelectorAll('.bulk-recipient-check:checked').length;
    const total   = document.querySelectorAll('.bulk-recipient-check').length;
    setBtn('sendAllTicketsBtn', false,
      total > 0
        ? `📤 ${checked} Ticket-Mail(s) versenden`
        : '📤 Alle bezahlten Tickets versenden'
    );
    setBtn('testEmailBtn', false, '📬 Test senden');
  }
}