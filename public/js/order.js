/* order.js – Bestellseite (fresh order + manage mode) */

const params   = new URLSearchParams(window.location.search);
const personId = params.get('personId');
const code     = params.get('code');
const mode     = params.get('mode'); // 'manage' = bestehende Bestellung

const personCard     = document.getElementById('personCard');
const personInfo     = document.getElementById('personInfo');
const orderCard      = document.getElementById('orderCard');
const paymentCard    = document.getElementById('paymentCard');
const ticketForms    = document.getElementById('ticketForms');
const totalPrice     = document.getElementById('totalPrice');
const pricePerTicket = document.getElementById('pricePerTicket');
const submitBtn      = document.getElementById('submitBtn');
const alertBox       = document.getElementById('alertBox');
const alertBox2      = document.getElementById('alertBox2');

let person         = null;
let config         = null;
let currentOrder   = null;
let currentTickets = [];

function showAlert(box, msg, type = 'danger') {
  box.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
}
function fmt(eur) {
  return Number(eur).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Init ──────────────────────────────────────────────────────────────────
async function init() {
  if (!personId) { window.location.href = '/'; return; }

  try {
    const cfgRes = await fetch('/api/tickets/config');
    config = await cfgRes.json();
    if (pricePerTicket) pricePerTicket.textContent = fmt(config.price);
    if (config.event) {
      document.title = `${config.event} – Ticketbestellung`;
      const navH1 = document.querySelector('.topbar h1');
      if (navH1) navH1.textContent = config.event;
    }

    const verifyRes  = await fetch('/api/codes/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const verifyData = await verifyRes.json();

    if (!verifyRes.ok) {
      personInfo.textContent = 'Ungültiger Zugangscode.';
      return;
    }

    person = verifyData.person;

    if (mode === 'manage' || verifyData.alreadyOrdered) {
      personInfo.innerHTML =
        `<strong>${esc(person.name)}</strong> &nbsp;|&nbsp; Code: <code>${esc(code)}</code>`;
      await loadManageMode();
      return;
    }

    personInfo.innerHTML =
      `<strong>${esc(person.name)}</strong> &nbsp;|&nbsp; Zugangscode: <code>${esc(code)}</code>` +
      ` &nbsp;|&nbsp; Verfügbare Tickets: <strong>${esc(String(person.num_tickets))}</strong>`;
    buildTicketForms(person.num_tickets);
    orderCard.style.display = 'block';

  } catch (err) {
    personInfo.textContent = 'Fehler beim Laden. Bitte Seite neu laden.';
  }
}

// ── Manage-Mode: bestehende Bestellung laden ─────────────────────────────
async function loadManageMode() {
  try {
    const res  = await fetch(`/api/tickets/my-order?code=${encodeURIComponent(code)}`);
    const data = await res.json();

    if (!res.ok) {
      // Noch keine Bestellung → Bestellformular zeigen
      personInfo.innerHTML =
        `<strong>${esc(person.name)}</strong> &nbsp;|&nbsp; Zugangscode: <code>${esc(code)}</code>` +
        ` &nbsp;|&nbsp; Verfügbare Tickets: <strong>${esc(String(person.num_tickets))}</strong>`;
      buildTicketForms(person.num_tickets);
      orderCard.style.display = 'block';
      return;
    }

    currentOrder   = data.order;
    currentTickets = data.tickets;

    orderCard.style.display   = 'none';
    paymentCard.style.display = 'block';

    renderManageTabs(data);

  } catch (err) {
    showAlert(alertBox, 'Verbindungsfehler beim Laden der Bestellung.', 'danger');
  }
}

// ── Tab-Styles einmalig injizieren ────────────────────────────────────────
function injectTabStyles() {
  if (document.getElementById('tabStyles')) return;
  const style = document.createElement('style');
  style.id = 'tabStyles';
  style.textContent = `
    .manage-tabs { display:flex; gap:.5rem; flex-wrap:wrap; margin-bottom:1.25rem; border-bottom:2px solid #e0e0e0; padding-bottom:.5rem; }
    .tab-btn { background:none; border:none; padding:.5rem 1.1rem; border-radius:6px 6px 0 0; cursor:pointer; font-size:.95rem; color:#555; font-weight:500; transition:background .15s,color .15s; }
    .tab-btn:hover { background:#f0f0f0; color:#222; }
    .tab-btn.active { background:#fff; color:#1a7a6e; border:2px solid #e0e0e0; border-bottom:2px solid #fff; margin-bottom:-2px; font-weight:700; }
    .ticket-qr-card { background:#f9f9f9; border-radius:10px; padding:1rem; margin-bottom:.85rem; box-shadow:0 1px 4px rgba(0,0,0,.07); }
    .paid-chip { display:inline-block; background:#27ae60; color:#fff; border-radius:20px; font-size:.78rem; padding:.15rem .65rem; margin-left:.5rem; vertical-align:middle; }
    .pending-chip { display:inline-block; background:#e67e22; color:#fff; border-radius:20px; font-size:.78rem; padding:.15rem .65rem; margin-left:.5rem; vertical-align:middle; }
    .qr-tabs { display:flex; gap:.4rem; flex-wrap:wrap; margin-bottom:1rem; }
    .qr-tab-btn { background:#f0f0f0; border:1.5px solid #ddd; padding:.35rem .9rem; border-radius:20px; cursor:pointer; font-size:.88rem; color:#444; font-weight:500; transition:background .15s,color .15s,border-color .15s; }
    .qr-tab-btn:hover { background:#e0e0e0; }
    .qr-tab-btn.active { background:#1a7a6e; color:#fff; border-color:#1a7a6e; }
    .qr-ticket-panel { display:none; }
    .qr-ticket-panel.active { display:block; }
  `;
  document.head.appendChild(style);
}

// ── Manage-Mode: Tabs rendern ─────────────────────────────────────────────
function renderManageTabs(data) {
  injectTabStyles();

  paymentCard.innerHTML = `
    <div class="manage-tabs">
      <button class="tab-btn active" data-tab="payment">Zahlung</button>
      <button class="tab-btn" data-tab="tickets">Meine QR-Codes</button>
      <button class="tab-btn" data-tab="edit">Angaben ändern</button>
    </div>
    <div class="tab-content" id="tab-payment"></div>
    <div class="tab-content" id="tab-tickets" style="display:none"></div>
    <div class="tab-content" id="tab-edit" style="display:none"></div>
  `;

  paymentCard.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      paymentCard.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      paymentCard.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).style.display = 'block';
    });
  });

  renderTabPayment(data);
  renderTabQrCodes(data);
  renderTabEdit(data);
}

// ── Tab: Zahlung ──────────────────────────────────────────────────────────
function renderTabPayment(data) {
  const tab = document.getElementById('tab-payment');
  const order = data.order;
  const paidAmount   = parseFloat(data.paidAmount   || 0);
  const remainingEur = parseFloat(data.remainingEur || 0);
  const totalEur     = parseFloat(order.total_eur);

  const fullyPaid = order.paid === 1;
  const partial   = order.paid === 2;

  let statusHtml = '';
  if (fullyPaid) {
    statusHtml = `<div style="background:#d4f5e2;border-radius:8px;padding:.75rem 1rem;margin-bottom:1rem;color:#1a7a2a;font-weight:600">✅ Vollständig bezahlt – Tickets wurden per E-Mail verschickt.</div>`;
  } else if (partial) {
    statusHtml = `<div style="background:#fff3cd;border-radius:8px;padding:.75rem 1rem;margin-bottom:1rem;color:#856404;font-weight:500">⚠️ Teilzahlung erhalten: <strong>${fmt(paidAmount)}</strong> von <strong>${fmt(totalEur)}</strong> – noch ausstehend: <strong>${fmt(remainingEur)}</strong></div>`;
  }

  // Split-Toggle: nur wenn noch nicht vollständig bezahlt
  let splitToggleHtml = '';
  if (!fullyPaid) {
    splitToggleHtml = `
      <div style="margin:1rem 0;padding:.75rem 1rem;background:#f0f7ff;border-radius:8px;display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
        <input type="checkbox" id="splitToggle" style="width:18px;height:18px;cursor:pointer" ${order.split_payment ? 'checked' : ''}>
        <label for="splitToggle" style="cursor:pointer;margin:0;font-weight:500">
          <strong>Separat zahlen</strong>
          <span style="font-weight:400;font-size:.85rem;color:#555"> – jede Person überweist ihr Ticket einzeln</span>
        </label>
        <span id="splitSpinner" style="display:none;font-size:.85rem;color:#888">Lädt…</span>
      </div>
    `;
  }

  // Anzeige-Betrag: Restbetrag bei Teilzahlung, sonst Gesamtbetrag
  const displayAmount = partial ? remainingEur : totalEur;

  tab.innerHTML = `
    ${statusHtml}
    ${splitToggleHtml}
    <div id="paymentDetails">
      ${renderPaymentDetails(data, displayAmount)}
    </div>
  `;

  if (!fullyPaid) {
    document.getElementById('splitToggle')
      .addEventListener('change', e => toggleSplit(e.target.checked, data));
  }
}

function renderPaymentDetails(data, displayAmount) {
  const order = data.order;

  if (order.split_payment) {
    let html = `<p style="margin-bottom:.75rem"><strong>Separat zahlen – jede Person überweist ihr Ticket einzeln:</strong></p>`;
    data.tickets.forEach((t, i) => {
      if (!t.split_ref) return;
      const isPaid = !!t.ticket_paid;
      html += `
        <div class="ticket-qr-card">
          <strong>Ticket ${i + 1} – ${esc(t.ticket_name)}</strong>
          ${isPaid ? '<span class="paid-chip">✓ Bezahlt</span>' : '<span class="pending-chip">Ausstehend</span>'}
          ${!isPaid ? `
            <div style="margin-top:.5rem;font-size:.9rem">
              <div>Betrag: <strong>${fmt(data.config.price)}</strong></div>
              <div>Referenz: <code>${esc(t.split_ref)}</code></div>
            </div>
            ${t.splitEpcQr ? `<img src="${t.splitEpcQr}" alt="Zahle QR ${i+1}" style="margin-top:.5rem;max-width:160px;border-radius:6px">` : ''}
          ` : '<div style="margin-top:.35rem;font-size:.88rem;color:#555">✅ Zahlung eingegangen – Ticket wurde per E-Mail zugestellt.</div>'}
        </div>
      `;
    });
    return html;
  }

  // Gemeinsame Überweisung
  return `
    <div style="margin-bottom:.5rem">
      <div style="margin-bottom:.35rem">Betrag: <strong style="font-size:1.1rem">${fmt(displayAmount)}</strong></div>
      <div>IBAN: <strong>${esc(data.config.iban)}</strong></div>
      <div>Empfänger: <strong>${esc(data.config.accountName)}</strong></div>
      <div>Referenz: <code>${esc(data.reference)}</code></div>
    </div>
    ${data.epcQr ? `<div style="margin-top:.75rem"><img src="${data.epcQr}" alt="Zahle QR" style="max-width:160px;border-radius:8px"></div>` : ''}
  `;
}

async function toggleSplit(enable, data) {
  const spinner = document.getElementById('splitSpinner');
  if (spinner) spinner.style.display = 'inline';

  const url = `/api/tickets/order/${currentOrder.id}/${enable ? 'enable' : 'disable'}-split`;
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const result = await res.json();

  if (!res.ok) {
    alert(result.error || 'Fehler beim Umschalten.');
    if (spinner) spinner.style.display = 'none';
    return;
  }

  currentOrder.split_payment = enable ? 1 : 0;
  data.order.split_payment   = enable ? 1 : 0;

  if (enable && result.splitEpcQrs) {
    result.splitEpcQrs.forEach(s => {
      const t = data.tickets.find(t => t.id === s.ticketId);
      if (t) { t.split_ref = s.ref; t.splitEpcQr = s.qr; }
    });
  } else if (!enable) {
    data.tickets.forEach(t => { t.split_ref = null; t.splitEpcQr = null; });
  }

  const paidAmount   = parseFloat(data.paidAmount   || 0);
  const remainingEur = parseFloat(data.remainingEur || 0);
  const totalEur     = parseFloat(data.order.total_eur);
  const displayAmount = data.order.paid === 2 ? remainingEur : totalEur;

  const detailsEl = document.getElementById('paymentDetails');
  if (detailsEl) detailsEl.innerHTML = renderPaymentDetails(data, displayAmount);
  if (spinner) spinner.style.display = 'none';
}

// ── Tab: QR-Codes (3 Tabs für bis zu N Tickets) ──────────────────────────
function renderTabQrCodes(data) {
  const tab = document.getElementById('tab-tickets');
  if (!data.tickets || !data.tickets.length) {
    tab.innerHTML = '<p style="color:#888">Keine Tickets gefunden.</p>';
    return;
  }

  const fullyPaid = data.order.paid === 1;

  // Warn-Banner wenn noch nicht vollständig bezahlt
  let warnHtml = '';
  if (!fullyPaid) {
    warnHtml = `<div style="background:#fff3cd;border-radius:8px;padding:.75rem 1rem;margin-bottom:1rem;color:#856404;font-size:.9rem">⚠️ QR-Codes werden erst nach vollständiger Bezahlung per E-Mail zugestellt. Die Vorschau hier ist nur zur Kontrolle.</div>`;
  }

  // Ticket-Tabs (ein Tab pro Ticket)
  const tabBtns = data.tickets.map((t, i) =>
    `<button class="qr-tab-btn${i === 0 ? ' active' : ''}" data-qrtab="${i}">Ticket ${i + 1}</button>`
  ).join('');

  const panels = data.tickets.map((t, i) => {
    const isPaid = fullyPaid || !!t.ticket_paid;
    const qrHtml = t.ticketQrDataUrl
      ? `<div style="margin-top:.75rem"><img src="${t.ticketQrDataUrl}" alt="QR-Code Ticket ${i+1}" style="max-width:200px;border-radius:8px;border:1px solid #eee"></div>`
      : `<div style="margin-top:.75rem;color:#999;font-size:.9rem">QR-Code wird nach Bezahlung generiert.</div>`;

    return `
      <div class="qr-ticket-panel${i === 0 ? ' active' : ''}" data-qrpanel="${i}">
        <div class="ticket-qr-card">
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:.35rem">
            <strong style="font-size:1.05rem">Ticket ${i + 1} – ${esc(t.ticket_name)}</strong>
            ${isPaid ? '<span class="paid-chip">✓ Bezahlt</span>' : '<span class="pending-chip">Ausstehend</span>'}
          </div>
          <div style="margin-top:.35rem;color:#555;font-size:.9rem">${esc(t.ticket_email || '–')}</div>
          ${t.split_ref ? `<div style="margin-top:.2rem;font-size:.82rem;color:#777">Referenz: <code>${esc(t.split_ref)}</code></div>` : ''}
          ${qrHtml}
        </div>
      </div>
    `;
  }).join('');

  tab.innerHTML = `
    ${warnHtml}
    <div class="qr-tabs">${tabBtns}</div>
    ${panels}
  `;

  // Tab-Switching
  tab.querySelectorAll('.qr-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      tab.querySelectorAll('.qr-tab-btn').forEach(b => b.classList.remove('active'));
      tab.querySelectorAll('.qr-ticket-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      tab.querySelector(`[data-qrpanel="${btn.dataset.qrtab}"]`).classList.add('active');
    });
  });
}

// ── Tab: Angaben ändern ───────────────────────────────────────────────────
function renderTabEdit(data) {
  const tab    = document.getElementById('tab-edit');
  const canAdd = !data.order.paid && data.remainingSlots > 0;

  tab.innerHTML = `
    <div id="manageAlertBox" style="margin-bottom:.75rem"></div>
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem;margin-bottom:1rem">
      <h3 style="margin:0">Ticket-Angaben</h3>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap">
        ${canAdd ? `<button id="addTicketBtn" class="btn btn-secondary" style="min-width:140px">Ticket hinzufügen</button>` : ''}
        <button id="toggleEditBtn" class="btn btn-primary" style="min-width:160px">Angaben ändern</button>
      </div>
    </div>
    ${canAdd ? `
      <div id="addTicketForm" style="display:none;margin-bottom:1rem;padding:1rem;background:#f0f7ff;border-radius:8px">
        <strong>Neues Ticket hinzufügen</strong>
        <div class="form-group" style="margin-top:.5rem">
          <label>Name</label>
          <input id="addTicketName" type="text" placeholder="Vollständiger Name" autocomplete="name">
        </div>
        <div class="form-group">
          <label>E-Mail</label>
          <input id="addTicketEmail" type="email" placeholder="name@beispiel.de" autocomplete="email">
        </div>
        <div style="display:flex;gap:.5rem;margin-top:.5rem">
          <button id="addTicketSaveBtn" class="btn btn-primary">Hinzufügen</button>
          <button id="addTicketCancelBtn" class="btn btn-secondary">Abbrechen</button>
        </div>
        <div id="addTicketFeedback" style="margin-top:.5rem"></div>
      </div>
    ` : ''}
    <div id="ticketList"></div>
  `;

  renderTicketList(currentTickets, false);

  document.getElementById('toggleEditBtn').addEventListener('click', () => {
    const btn     = document.getElementById('toggleEditBtn');
    const editing = btn.dataset.editing === 'true';
    renderTicketList(currentTickets, !editing);
    btn.dataset.editing = String(!editing);
    btn.textContent = !editing ? 'Abbrechen' : 'Angaben ändern';
  });

  if (canAdd) {
    document.getElementById('addTicketBtn').addEventListener('click', () => {
      document.getElementById('addTicketForm').style.display = 'block';
      document.getElementById('addTicketBtn').style.display  = 'none';
      document.getElementById('addTicketName').focus();
    });
    document.getElementById('addTicketCancelBtn').addEventListener('click', () => {
      document.getElementById('addTicketForm').style.display = 'none';
      document.getElementById('addTicketBtn').style.display  = '';
    });
    document.getElementById('addTicketSaveBtn').addEventListener('click', addTicket);
  }
}

// ── Ticket hinzufügen (Manage-Mode) ──────────────────────────────────────
async function addTicket() {
  const nameInput  = document.getElementById('addTicketName');
  const emailInput = document.getElementById('addTicketEmail');
  const feedback   = document.getElementById('addTicketFeedback');
  const saveBtn    = document.getElementById('addTicketSaveBtn');

  const ticketName  = nameInput.value.trim();
  const ticketEmail = emailInput.value.trim();

  if (!ticketName) {
    feedback.innerHTML = '<span style="color:red">Name darf nicht leer sein.</span>';
    return;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ticketEmail)) {
    feedback.innerHTML = '<span style="color:red">Ungültige E-Mail-Adresse.</span>';
    return;
  }

  saveBtn.disabled    = true;
  saveBtn.textContent = 'Lädt…';
  feedback.innerHTML  = '';

  try {
    const res = await fetch(`/api/tickets/order/${currentOrder.id}/add`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ code, ticketName, ticketEmail }),
    });
    const data = await res.json();

    if (!res.ok) {
      feedback.innerHTML = `<span style="color:red">${esc(data.message || data.error)}</span>`;
      return;
    }

    currentTickets.push(data.ticket);
    currentOrder.total_eur = data.newTotalEur;

    nameInput.value  = '';
    emailInput.value = '';
    document.getElementById('addTicketForm').style.display = 'none';
    document.getElementById('addTicketBtn').style.display  = '';

    renderTicketList(currentTickets, false);
    showAlert(document.getElementById('manageAlertBox'), 'Ticket erfolgreich hinzugefügt.', 'success');

  } catch {
    feedback.innerHTML = '<span style="color:red">Verbindungsfehler.</span>';
  } finally {
    saveBtn.disabled    = false;
    saveBtn.textContent = 'Hinzufügen';
  }
}

// ── Ticket-Liste rendern ─────────────────────────────────────────────────
function renderTicketList(tickets, editMode) {
  const container = document.getElementById('ticketList');
  if (!container) return;
  container.innerHTML = '';

  tickets.forEach((ticket, i) => {
    const div = document.createElement('div');
    div.style.cssText = 'background:#f9f9f9;border-radius:10px;padding:1rem;margin-bottom:.75rem;box-shadow:0 1px 3px rgba(0,0,0,.06)';
    div.dataset.ticketId = ticket.id;

    if (editMode) {
      div.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem">
          <strong>Ticket ${i + 1}</strong>
          ${!currentOrder.paid ? `<button class="btn btn-danger delete-ticket-btn" style="padding:.25rem .75rem;font-size:.85rem" title="Ticket löschen">Löschen</button>` : ''}
        </div>
        <div class="form-group" style="margin-top:.5rem">
          <label>Name</label>
          <input class="edit-name" type="text" value="${esc(ticket.ticket_name)}" required>
        </div>
        <div class="form-group">
          <label>E-Mail</label>
          <input class="edit-email" type="email" value="${esc(ticket.ticket_email || '')}" required>
        </div>
        <div style="display:flex;gap:.5rem;margin-top:.5rem;flex-wrap:wrap">
          <button class="btn btn-primary save-ticket-btn" style="min-width:100px">Speichern</button>
        </div>
        <div class="ticket-feedback" style="margin-top:.5rem"></div>
      `;
      div.querySelector('.save-ticket-btn').addEventListener('click', () => saveTicket(div, ticket));
      const deleteBtn = div.querySelector('.delete-ticket-btn');
      if (deleteBtn) deleteBtn.addEventListener('click', () => confirmDeleteTicket(ticket, i));
    } else {
      div.innerHTML = `
        <strong>Ticket ${i + 1}</strong>
        <div style="margin-top:.4rem;color:#555">
          <div>${esc(ticket.ticket_name)}</div>
          <div>${esc(ticket.ticket_email || '–')}</div>
          ${ticket.split_ref ? `<div style="margin-top:.25rem;font-size:.85rem">Referenz: <code>${esc(ticket.split_ref)}</code></div>` : ''}
        </div>
      `;
    }
    container.appendChild(div);
  });
}

// ── Ticket löschen ───────────────────────────────────────────────────────
async function confirmDeleteTicket(ticket, index) {
  const manageAlert = document.getElementById('manageAlertBox');

  if (currentTickets.length <= 1) {
    showAlert(manageAlert,
      'Mindestens ein Ticket muss in der Bestellung verbleiben. Wende dich an das Orga-Team, um die gesamte Bestellung zu stornieren.',
      'warning'
    );
    return;
  }

  if (!confirm(`Ticket ${index + 1} (${ticket.ticket_name}) wirklich löschen?`)) return;

  try {
    const res = await fetch(
      `/api/tickets/order/${currentOrder.id}/ticket/${ticket.id}`,
      { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) }
    );
    const data = await res.json();

    if (res.status === 409 && data.error === 'paid_order') {
      showAlert(manageAlert, 'Diese Bestellung wurde bereits bezahlt. Bitte wende dich an das Orga-Team.', 'danger');
      return;
    }
    if (res.status === 409 && data.error === 'last_ticket') {
      showAlert(manageAlert, 'Mindestens ein Ticket muss verbleiben.', 'warning');
      return;
    }
    if (!res.ok) { showAlert(manageAlert, data.error || 'Fehler beim Löschen.', 'danger'); return; }

    currentTickets = currentTickets.filter(t => t.id !== ticket.id);
    currentOrder.total_eur = data.newTotalEur;

    renderTicketList(currentTickets, true);
    showAlert(manageAlert, 'Ticket erfolgreich gelöscht.', 'success');

  } catch { showAlert(manageAlert, 'Verbindungsfehler beim Löschen.', 'danger'); }
}

// ── Ticket speichern (PATCH) ─────────────────────────────────────────────
async function saveTicket(div, ticket) {
  const nameInput  = div.querySelector('.edit-name');
  const emailInput = div.querySelector('.edit-email');
  const feedback   = div.querySelector('.ticket-feedback');
  const saveBtn    = div.querySelector('.save-ticket-btn');

  const ticketName  = nameInput.value.trim();
  const ticketEmail = emailInput.value.trim();

  if (!ticketName) { feedback.innerHTML = '<span style="color:red">Name darf nicht leer sein.</span>'; return; }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ticketEmail)) {
    feedback.innerHTML = '<span style="color:red">Ungültige E-Mail-Adresse.</span>'; return;
  }

  saveBtn.disabled    = true;
  saveBtn.textContent = 'Speichere…';
  feedback.innerHTML  = '';

  try {
    const res = await fetch(
      `/api/tickets/order/${currentOrder.id}/ticket/${ticket.id}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, ticketName, ticketEmail }) }
    );
    const data = await res.json();

    if (!res.ok) { feedback.innerHTML = `<span style="color:red">${esc(data.error)}</span>`; return; }

    ticket.ticket_name  = ticketName;
    ticket.ticket_email = ticketEmail;
    feedback.innerHTML  = '<span style="color:green">✓ Gespeichert</span>';

    const manageAlert = document.getElementById('manageAlertBox');
    if (data.paid && (data.nameChanged || data.emailChanged)) {
      if (data.emailResent) {
        showAlert(manageAlert, '✅ Angaben geändert – ein aktualisiertes Ticket wurde automatisch an die hinterlegte E-Mail-Adresse gesendet.', 'success');
      } else {
        showAlert(manageAlert, '⚠️ Angaben geändert, aber E-Mail-Versand fehlgeschlagen. Bitte Orga-Team kontaktieren.', 'warning');
      }
    }
  } catch { feedback.innerHTML = '<span style="color:red">Verbindungsfehler.</span>'; }
  finally {
    saveBtn.disabled    = false;
    saveBtn.textContent = 'Speichern';
  }
}

// ── Ticket-Formulare aufbauen (fresh order) ──────────────────────────────
function buildTicketForms(count) {
  ticketForms.innerHTML = '';

  const hint = document.createElement('p');
  hint.style.cssText = 'color:#666;font-size:.9rem;margin-bottom:.75rem';
  hint.textContent = `Du kannst 1 bis ${count} Ticket(s) bestellen. Felder die du leer lässt werden nicht berechnet.`;
  ticketForms.appendChild(hint);

  for (let i = 1; i <= count; i++) {
    const div = document.createElement('div');
    div.className = 'card';
    div.style.cssText = 'background:#f9f9f9;box-shadow:none;padding:1rem;margin-bottom:.75rem;';
    div.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between">
        <strong>Ticket ${i}</strong>
        ${i > 1 ? `<span style="font-size:.8rem;color:#999">optional</span>` : ''}
      </div>
      <div class="form-group" style="margin-top:.5rem">
        <label for="ticketName${i}">Name der Person${i === 1 ? ' *' : ''}</label>
        <input id="ticketName${i}" type="text" name="ticketName"
          placeholder="Vollständiger Name" ${i === 1 ? 'required' : ''} autocomplete="name">
      </div>
      <div class="form-group">
        <label for="ticketEmail${i}">E-Mail-Adresse${i === 1 ? ' *' : ''}</label>
        <input id="ticketEmail${i}" type="email" name="ticketEmail"
          placeholder="name@beispiel.de" ${i === 1 ? 'required' : ''} autocomplete="email">
      </div>
    `;
    ticketForms.appendChild(div);
  }

  const allNameInputs = ticketForms.querySelectorAll('[name=ticketName]');
  allNameInputs.forEach(inp => inp.addEventListener('input', updateTotal));
  updateTotal();
}

function updateTotal() {
  if (!config) return;
  const forms      = ticketForms.querySelectorAll('.card');
  let filledCount  = 0;
  forms.forEach(f => {
    const n = f.querySelector('[name=ticketName]');
    if (n && n.value.trim()) filledCount++;
  });
  const count = filledCount || (person ? 1 : 0);
  if (totalPrice) totalPrice.textContent = fmt(count * config.price);
}

// ── Bestellung absenden ──────────────────────────────────────────────────
submitBtn.addEventListener('click', async () => {
  alertBox.innerHTML = '';
  const tickets = [];
  const forms   = ticketForms.querySelectorAll('.card');
  const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  for (const form of forms) {
    const nameInput  = form.querySelector('[name=ticketName]');
    const emailInput = form.querySelector('[name=ticketEmail]');
    if (!nameInput || !emailInput) continue;
    const name  = nameInput.value.trim();
    const email = emailInput.value.trim();

    if (!name && !email) continue;

    if (!name)  { showAlert(alertBox, 'Bitte den Namen für jedes begonnene Ticket ausfüllen.'); nameInput.focus(); return; }
    if (!email || !emailRe.test(email)) {
      showAlert(alertBox, 'Bitte eine gültige E-Mail-Adresse für jedes begonnene Ticket eingeben.'); emailInput.focus(); return;
    }
    tickets.push({ ticketName: name, ticketEmail: email });
  }

  if (tickets.length === 0) {
    showAlert(alertBox, 'Bitte mindestens ein Ticket ausfüllen.');
    return;
  }

  submitBtn.disabled  = true;
  submitBtn.innerHTML = '<span class="spinner"></span> Sende…';

  try {
    const res  = await fetch('/api/tickets/order', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personId: person.id, tickets }),
    });
    const data = await res.json();

    if (res.status === 409) {
      showAlert(alertBox,
        'Du hast bereits eine Bestellung abgesendet. ' +
        `<a href="/order.html?personId=${person.id}&code=${encodeURIComponent(code)}&mode=manage">Hier einsehen →</a>`,
        'warning'
      );
      return;
    }
    if (!res.ok) { showAlert(alertBox, data.error || 'Fehler beim Absenden.'); return; }

    currentOrder   = { id: data.orderId, total_eur: data.totalEur, paid: 0, split_payment: 0 };
    currentTickets = tickets.map(t => ({ id: null, ticket_name: t.ticketName, ticket_email: t.ticketEmail }));

    orderCard.style.display   = 'none';
    paymentCard.style.display = 'block';

    // Frische Daten vom Server inkl. QR-Codes laden
    const freshRes  = await fetch(`/api/tickets/my-order?code=${encodeURIComponent(code)}`);
    const freshData = await freshRes.json();
    if (freshRes.ok) {
      currentOrder   = freshData.order;
      currentTickets = freshData.tickets;
      renderManageTabs(freshData);
    } else {
      // Fallback
      paymentCard.innerHTML = `
        <h3>Zahlungsanweisung</h3>
        <div>Betrag: <strong>${fmt(data.totalEur)}</strong></div>
        <div>IBAN: <strong>${esc(config.iban)}</strong></div>
        <div>Empfänger: <strong>${esc(config.accountName)}</strong></div>
        <div>Referenz: <code>${esc(data.reference)}</code></div>
        ${data.epcQr ? `<img src="${data.epcQr}" style="max-width:160px;margin-top:.75rem">` : ''}
      `;
    }

  } catch { showAlert(alertBox, 'Verbindungsfehler. Bitte versuche es erneut.'); }
  finally {
    submitBtn.disabled  = false;
    submitBtn.innerHTML = 'Bestellung absenden &amp; Zahlungsinfo erhalten';
  }
});

init();
