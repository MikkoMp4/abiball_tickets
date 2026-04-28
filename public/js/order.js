/* order.js – Bestellseite (fresh order + manage mode) */

const params   = new URLSearchParams(window.location.search);
const personId = params.get('personId');
const code     = params.get('code');
const mode     = params.get('mode');

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

// ── Manage-Mode styles ────────────────────────────────────────────────────
function injectManageStyles() {
  if (document.getElementById('manageStyles')) return;
  const s = document.createElement('style');
  s.id = 'manageStyles';
  s.textContent = `
    /* ── Tab bar ── */
    .m-tabs {
      display: flex;
      gap: .25rem;
      border-bottom: 2px solid var(--border);
      margin-bottom: 1.5rem;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .m-tabs::-webkit-scrollbar { display: none; }
    .m-tab {
      padding: .6rem 1.2rem;
      font-size: .875rem;
      font-weight: 600;
      color: var(--muted);
      border: none;
      background: none;
      border-bottom: 3px solid transparent;
      margin-bottom: -2px;
      cursor: pointer;
      white-space: nowrap;
      min-height: 44px;
      transition: color var(--ease), border-color var(--ease);
    }
    .m-tab:hover  { color: var(--text); }
    .m-tab.active { color: var(--primary); border-bottom-color: var(--primary); }
    .m-pane { display: none; }
    .m-pane.active { display: block; }

    /* ── Status banners ── */
    .status-paid {
      background: var(--success-bg);
      color: var(--success);
      border-left: 4px solid var(--success);
      border-radius: var(--radius);
      padding: .9rem 1rem;
      font-weight: 600;
      font-size: .9rem;
      margin-bottom: 1.25rem;
      display: flex;
      align-items: center;
      gap: .5rem;
    }
    .status-partial {
      background: var(--warning-bg);
      color: var(--warning);
      border-left: 4px solid var(--warning);
      border-radius: var(--radius);
      padding: .9rem 1rem;
      font-size: .9rem;
      margin-bottom: 1.25rem;
    }

    /* ── Payment box ── */
    .pay-box {
      border: 1.5px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      margin-bottom: 1.25rem;
      box-shadow: var(--shadow-sm);
    }
    .pay-box-header {
      background: var(--primary-light);
      padding: .65rem 1rem;
      font-size: .75rem;
      font-weight: 700;
      color: var(--primary-dark);
      text-transform: uppercase;
      letter-spacing: .06em;
      border-bottom: 1px solid rgba(230,126,34,.15);
    }
    .pay-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: .7rem 1rem;
      border-bottom: 1px solid var(--border);
      font-size: .9rem;
      gap: .5rem;
    }
    .pay-row:last-child { border-bottom: none; }
    .pay-row-label {
      color: var(--muted);
      font-size: .8rem;
      font-weight: 500;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .pay-row-value {
      font-weight: 600;
      text-align: right;
      word-break: break-all;
    }
    .pay-row-value code {
      font-family: 'Courier New', monospace;
      font-size: .83rem;
      background: var(--primary-light);
      color: var(--primary-dark);
      padding: .15rem .45rem;
      border-radius: 4px;
    }
    .pay-amount {
      font-family: var(--font-display);
      font-size: 1.6rem;
      font-weight: 800;
      color: var(--primary);
      line-height: 1;
    }

    /* ── QR block ── */
    .qr-block {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: .6rem;
      padding: 1.25rem 1rem;
      background: var(--card-2);
      border: 1.5px solid var(--border);
      border-radius: var(--radius);
      margin-bottom: 1.25rem;
      box-shadow: var(--shadow-sm);
    }
    .qr-block img {
      width: 192px;
      height: 192px;
      border-radius: var(--radius-sm);
      border: 2px solid var(--border);
      display: block;
      background: #fff;
    }
    .qr-block-label {
      font-size: .78rem;
      color: var(--muted);
      text-align: center;
      font-weight: 500;
    }
    .qr-block-title {
      font-size: .75rem;
      font-weight: 700;
      color: var(--primary-dark);
      text-transform: uppercase;
      letter-spacing: .05em;
    }

    /* ── Split toggle ── */
    .split-toggle-row {
      display: flex;
      align-items: center;
      gap: .75rem;
      padding: .85rem 1rem;
      background: var(--card-2);
      border: 1.5px solid var(--border);
      border-radius: var(--radius);
      margin-bottom: 1.25rem;
      flex-wrap: wrap;
    }
    .split-toggle-row input[type=checkbox] {
      width: 18px; height: 18px; cursor: pointer; accent-color: var(--primary); flex-shrink: 0;
    }
    .split-toggle-row label { cursor: pointer; margin: 0; font-weight: 500; font-size: .9rem; }
    .split-toggle-row .sub { font-size: .8rem; color: var(--muted); }
    #splitSpinner { font-size: .82rem; color: var(--muted); }

    /* ── Ticket cards ── */
    .t-card {
      background: var(--card-2);
      border: 1.5px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem 1.1rem;
      margin-bottom: .85rem;
      box-shadow: var(--shadow-sm);
      transition: box-shadow var(--ease);
    }
    .t-card:hover { box-shadow: var(--shadow); }
    .t-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: .5rem;
      flex-wrap: wrap;
      margin-bottom: .5rem;
    }
    .t-card-title { font-weight: 700; font-size: .975rem; }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: .25rem;
      padding: .2rem .7rem;
      border-radius: var(--radius-full);
      font-size: .73rem;
      font-weight: 700;
      white-space: nowrap;
    }
    .chip-paid    { background: var(--success-bg); color: var(--success); }
    .chip-pending { background: var(--warning-bg); color: var(--warning); }

    /* ── QR sub-tabs (pill) ── */
    .qr-subtabs {
      display: flex;
      gap: .4rem;
      flex-wrap: wrap;
      margin-bottom: 1rem;
    }
    .qr-subtab {
      padding: .35rem .95rem;
      border-radius: var(--radius-full);
      border: 1.5px solid var(--border);
      background: var(--card-2);
      font-size: .85rem;
      font-weight: 600;
      color: var(--muted);
      cursor: pointer;
      transition: all var(--ease);
      min-height: 36px;
    }
    .qr-subtab:hover  { border-color: var(--primary); color: var(--primary); }
    .qr-subtab.active { background: var(--primary); border-color: var(--primary); color: #fff; }
    .qr-subpane { display: none; }
    .qr-subpane.active { display: block; }

    /* ── Edit form ── */
    .edit-form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: .75rem;
      margin-top: .6rem;
    }
    @media (max-width: 520px) { .edit-form-row { grid-template-columns: 1fr; } }
    .edit-actions {
      display: flex;
      gap: .5rem;
      margin-top: .75rem;
      flex-wrap: wrap;
      align-items: center;
    }
    .t-meta {
      font-size: .875rem;
      color: var(--muted);
      margin-top: .2rem;
      display: flex;
      align-items: center;
      gap: .3rem;
    }
    .t-meta code {
      font-size: .8rem;
      background: var(--primary-light);
      color: var(--primary-dark);
      padding: .1rem .35rem;
      border-radius: 4px;
    }

    /* ── Add ticket form ── */
    .add-form {
      background: var(--card-2);
      border: 1.5px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem 1.1rem;
      margin-bottom: 1rem;
      box-shadow: var(--shadow-sm);
    }
    .add-form h4 { font-size: .9rem; font-weight: 700; margin-bottom: .75rem; }
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: .5rem;
      margin-bottom: 1rem;
    }
    .section-header h3 { font-size: 1rem; font-weight: 700; margin: 0; }
    .btn-sm {
      padding: .4rem .9rem;
      font-size: .825rem;
      min-height: 36px;
    }
    .feedback-ok  { color: var(--success); font-size: .85rem; font-weight: 500; }
    .feedback-err { color: var(--danger);  font-size: .85rem; }

    /* ── QR notice (unpaid warning) ── */
    .qr-notice {
      background: var(--warning-bg);
      color: var(--warning);
      border: 1.5px solid rgba(230,81,0,.2);
      border-radius: var(--radius);
      padding: .75rem 1rem;
      font-size: .85rem;
      margin-bottom: 1.25rem;
      font-weight: 500;
    }

    /* ── Divider ── */
    .pay-divider {
      border: none;
      border-top: 1.5px solid var(--border);
      margin: 1rem 0;
    }
  `;
  document.head.appendChild(s);
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
        `<strong>${esc(person.name)}</strong>&nbsp; &middot; &nbsp;Code: <code>${esc(code)}</code>`;
      await loadManageMode();
      return;
    }

    personInfo.innerHTML =
      `<strong>${esc(person.name)}</strong>&nbsp; &middot; &nbsp;Code: <code>${esc(code)}</code>` +
      `&nbsp; &middot; &nbsp;Verfügbare Tickets: <strong>${esc(String(person.num_tickets))}</strong>`;
    buildTicketForms(person.num_tickets);
    orderCard.style.display = 'block';

  } catch (err) {
    personInfo.textContent = 'Fehler beim Laden. Bitte Seite neu laden.';
  }
}

// ── Manage-Mode laden ─────────────────────────────────────────────────────
async function loadManageMode() {
  try {
    const res  = await fetch(`/api/tickets/my-order?code=${encodeURIComponent(code)}`);
    const data = await res.json();

    if (!res.ok) {
      personInfo.innerHTML =
        `<strong>${esc(person.name)}</strong>&nbsp; &middot; &nbsp;Code: <code>${esc(code)}</code>` +
        `&nbsp; &middot; &nbsp;Verfügbare Tickets: <strong>${esc(String(person.num_tickets))}</strong>`;
      buildTicketForms(person.num_tickets);
      orderCard.style.display = 'block';
      return;
    }

    currentOrder   = data.order;
    currentTickets = data.tickets;

    orderCard.style.display   = 'none';
    paymentCard.style.display = 'block';
    renderManage(data);

  } catch (err) {
    showAlert(alertBox, 'Verbindungsfehler beim Laden der Bestellung.', 'danger');
  }
}

// ── Manage-Wrapper rendern ────────────────────────────────────────────────
function renderManage(data) {
  injectManageStyles();

  paymentCard.innerHTML = `
    <div class="m-tabs">
      <button class="m-tab active" data-pane="payment">Zahlung</button>
      <button class="m-tab" data-pane="qrcodes">Meine QR-Codes</button>
      <button class="m-tab" data-pane="edit">Angaben ändern</button>
    </div>
    <div id="m-payment" class="m-pane active"></div>
    <div id="m-qrcodes" class="m-pane"></div>
    <div id="m-edit"    class="m-pane"></div>
  `;

  paymentCard.querySelectorAll('.m-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      paymentCard.querySelectorAll('.m-tab').forEach(b => b.classList.remove('active'));
      paymentCard.querySelectorAll('.m-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`m-${btn.dataset.pane}`).classList.add('active');
    });
  });

  renderPaymentPane(data);
  renderQrPane(data);
  renderEditPane(data);
}

// ── Tab: Zahlung ──────────────────────────────────────────────────────────
function renderPaymentPane(data) {
  const pane       = document.getElementById('m-payment');
  const order      = data.order;
  const paidAmount = parseFloat(data.paidAmount   || 0);
  const remEur     = parseFloat(data.remainingEur || 0);
  const totalEur   = parseFloat(order.total_eur);
  const fullyPaid  = order.paid === 1;
  const partial    = order.paid === 2;

  let statusHtml = '';
  if (fullyPaid) {
    statusHtml = `<div class="status-paid"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Vollständig bezahlt – Tickets wurden per E-Mail verschickt.</div>`;
  } else if (partial) {
    statusHtml = `<div class="status-partial">Teilzahlung erhalten: <strong>${fmt(paidAmount)}</strong> von <strong>${fmt(totalEur)}</strong> – noch ausstehend: <strong>${fmt(remEur)}</strong></div>`;
  }

  let splitToggle = '';
  if (!fullyPaid) {
    splitToggle = `
      <div class="split-toggle-row">
        <input type="checkbox" id="splitToggle" ${order.split_payment ? 'checked' : ''}>
        <label for="splitToggle">
          Separat zahlen
          <span class="sub"> – jede Person überweist ihr Ticket einzeln</span>
        </label>
        <span id="splitSpinner" style="display:none">Lädt…</span>
      </div>
    `;
  }

  const displayAmount = partial ? remEur : totalEur;

  pane.innerHTML = `
    ${statusHtml}
    ${splitToggle}
    <div id="paymentDetails"></div>
  `;

  renderPaymentDetails(data, displayAmount);

  if (!fullyPaid) {
    document.getElementById('splitToggle')
      .addEventListener('change', e => toggleSplit(e.target.checked, data));
  }
}

function renderPaymentDetails(data, displayAmount) {
  const el    = document.getElementById('paymentDetails');
  const order = data.order;

  if (order.split_payment) {
    let html = '';
    data.tickets.forEach((t, i) => {
      if (!t.split_ref) return;
      const isPaid = !!t.ticket_paid;
      html += `
        <div class="t-card">
          <div class="t-card-header">
            <span class="t-card-title">Ticket ${i + 1} &mdash; ${esc(t.ticket_name)}</span>
            ${isPaid
              ? '<span class="chip chip-paid">Bezahlt</span>'
              : '<span class="chip chip-pending">Ausstehend</span>'}
          </div>
          ${!isPaid ? `
            <div class="pay-box">
              <div class="pay-box-header">Zahlungsdetails</div>
              <div class="pay-row">
                <span class="pay-row-label">Betrag</span>
                <span class="pay-row-value pay-amount">${fmt(data.config.price)}</span>
              </div>
              <div class="pay-row">
                <span class="pay-row-label">Referenz</span>
                <span class="pay-row-value"><code>${esc(t.split_ref)}</code></span>
              </div>
            </div>
            ${t.splitEpcQr ? `
              <div class="qr-block">
                <span class="qr-block-title">GiroCode – Banking-App scannen</span>
                <img src="${t.splitEpcQr}" alt="Zahlung QR Ticket ${i + 1}" width="192" height="192">
                <span class="qr-block-label">Referenz: ${esc(t.split_ref)}</span>
              </div>` : ''}
          ` : `<p class="t-meta" style="margin-top:.25rem">Zahlung eingegangen – Ticket wurde per E-Mail zugestellt.</p>`}
        </div>
      `;
    });
    el.innerHTML = html || '<p style="color:var(--muted)">Keine Split-Tickets gefunden.</p>';
    return;
  }

  // Gemeinsame Überweisung
  el.innerHTML = `
    <div class="pay-box">
      <div class="pay-box-header">Zahlungsdetails</div>
      <div class="pay-row">
        <span class="pay-row-label">Betrag</span>
        <span class="pay-row-value pay-amount">${fmt(displayAmount)}</span>
      </div>
      <div class="pay-row">
        <span class="pay-row-label">Empfänger</span>
        <span class="pay-row-value">${esc(data.config.accountName)}</span>
      </div>
      <div class="pay-row">
        <span class="pay-row-label">IBAN</span>
        <span class="pay-row-value"><code>${esc(data.config.iban)}</code></span>
      </div>
      <div class="pay-row">
        <span class="pay-row-label">Verwendungszweck</span>
        <span class="pay-row-value"><code>${esc(data.reference)}</code></span>
      </div>
    </div>
    ${data.epcQr ? `
      <div class="qr-block">
        <span class="qr-block-title">GiroCode – Banking-App scannen</span>
        <img src="${data.epcQr}" alt="Zahlung QR-Code" width="192" height="192">
        <span class="qr-block-label">Überweist ${fmt(displayAmount)} mit Referenz ${esc(data.reference)}</span>
      </div>` : ''}
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

  const remEur        = parseFloat(data.remainingEur || 0);
  const totalEur      = parseFloat(data.order.total_eur);
  const displayAmount = data.order.paid === 2 ? remEur : totalEur;
  renderPaymentDetails(data, displayAmount);
  if (spinner) spinner.style.display = 'none';
}

// ── Tab: QR-Codes ─────────────────────────────────────────────────────────
function renderQrPane(data) {
  const pane      = document.getElementById('m-qrcodes');
  const fullyPaid = data.order.paid === 1;

  if (!data.tickets || !data.tickets.length) {
    pane.innerHTML = '<p style="color:var(--muted)">Keine Tickets gefunden.</p>';
    return;
  }

  let warn = '';
  if (!fullyPaid) {
    warn = `<div class="qr-notice">QR-Codes sind erst nach vollständiger Bezahlung gültig und werden dann per E-Mail zugestellt. Die Vorschau hier dient nur zur Kontrolle.</div>`;
  }

  const subtabBtns = data.tickets.map((t, i) =>
    `<button class="qr-subtab${i === 0 ? ' active' : ''}" data-qi="${i}">Ticket ${i + 1}</button>`
  ).join('');

  const panels = data.tickets.map((t, i) => {
    const isPaid = fullyPaid || !!t.ticket_paid;
    const qrHtml = t.ticketQrDataUrl
      ? `<div class="qr-block" style="margin-top:.75rem">
           <span class="qr-block-title">Ticket-QR-Code</span>
           <img src="${t.ticketQrDataUrl}" alt="QR-Code Ticket ${i + 1}" width="192" height="192">
           <span class="qr-block-label">${esc(t.ticket_name)}</span>
         </div>`
      : `<p style="color:var(--muted);font-size:.875rem;margin-top:.75rem">QR-Code wird nach Bezahlung verfügbar.</p>`;

    return `
      <div class="qr-subpane${i === 0 ? ' active' : ''}" data-qp="${i}">
        <div class="t-card">
          <div class="t-card-header">
            <span class="t-card-title">${esc(t.ticket_name)}</span>
            ${isPaid
              ? '<span class="chip chip-paid">Bezahlt</span>'
              : '<span class="chip chip-pending">Ausstehend</span>'}
          </div>
          <div class="t-meta">${esc(t.ticket_email || '–')}</div>
          ${t.split_ref ? `<div class="t-meta">Referenz:&nbsp;<code>${esc(t.split_ref)}</code></div>` : ''}
          ${qrHtml}
        </div>
      </div>
    `;
  }).join('');

  pane.innerHTML = `${warn}<div class="qr-subtabs">${subtabBtns}</div>${panels}`;

  pane.querySelectorAll('.qr-subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      pane.querySelectorAll('.qr-subtab').forEach(b => b.classList.remove('active'));
      pane.querySelectorAll('.qr-subpane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      pane.querySelector(`[data-qp="${btn.dataset.qi}"]`).classList.add('active');
    });
  });
}

// ── Tab: Angaben ändern ───────────────────────────────────────────────────
function renderEditPane(data) {
  const pane   = document.getElementById('m-edit');
  const canAdd = !data.order.paid && data.remainingSlots > 0;

  pane.innerHTML = `
    <div id="manageAlertBox" style="margin-bottom:.75rem"></div>
    <div class="section-header">
      <h3>Ticket-Angaben</h3>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap">
        ${canAdd ? `<button id="addTicketBtn" class="btn btn-outline-dark btn-sm">Ticket hinzufügen</button>` : ''}
        <button id="toggleEditBtn" class="btn btn-primary btn-sm">Angaben bearbeiten</button>
      </div>
    </div>
    ${canAdd ? `
      <div id="addTicketForm" class="add-form" style="display:none">
        <h4>Neues Ticket</h4>
        <div class="edit-form-row">
          <div class="form-group" style="margin-bottom:0">
            <label>Name</label>
            <input id="addTicketName" type="text" placeholder="Vollständiger Name" autocomplete="name">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label>E-Mail</label>
            <input id="addTicketEmail" type="email" placeholder="name@beispiel.de" autocomplete="email">
          </div>
        </div>
        <div class="edit-actions">
          <button id="addTicketSaveBtn" class="btn btn-primary btn-sm">Hinzufügen</button>
          <button id="addTicketCancelBtn" class="btn btn-outline-dark btn-sm">Abbrechen</button>
        </div>
        <div id="addTicketFeedback" style="margin-top:.5rem"></div>
      </div>` : ''}
    <div id="ticketList"></div>
  `;

  renderTicketList(currentTickets, false);

  document.getElementById('toggleEditBtn').addEventListener('click', () => {
    const btn     = document.getElementById('toggleEditBtn');
    const editing = btn.dataset.editing === 'true';
    renderTicketList(currentTickets, !editing);
    btn.dataset.editing = String(!editing);
    btn.textContent = !editing ? 'Abbrechen' : 'Angaben bearbeiten';
    btn.className   = !editing ? 'btn btn-outline-dark btn-sm' : 'btn btn-primary btn-sm';
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

// ── Ticket hinzufügen ─────────────────────────────────────────────────────
async function addTicket() {
  const nameInput  = document.getElementById('addTicketName');
  const emailInput = document.getElementById('addTicketEmail');
  const feedback   = document.getElementById('addTicketFeedback');
  const saveBtn    = document.getElementById('addTicketSaveBtn');

  const ticketName  = nameInput.value.trim();
  const ticketEmail = emailInput.value.trim();

  if (!ticketName) { feedback.innerHTML = '<span class="feedback-err">Name darf nicht leer sein.</span>'; return; }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ticketEmail)) {
    feedback.innerHTML = '<span class="feedback-err">Ungültige E-Mail-Adresse.</span>'; return;
  }

  saveBtn.disabled    = true;
  saveBtn.textContent = 'Lädt…';
  feedback.innerHTML  = '';

  try {
    const res = await fetch(`/api/tickets/order/${currentOrder.id}/add`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, ticketName, ticketEmail }),
    });
    const data = await res.json();

    if (!res.ok) {
      feedback.innerHTML = `<span class="feedback-err">${esc(data.message || data.error)}</span>`;
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
    feedback.innerHTML = '<span class="feedback-err">Verbindungsfehler.</span>';
  } finally {
    saveBtn.disabled    = false;
    saveBtn.textContent = 'Hinzufügen';
  }
}

// ── Ticket-Liste rendern ──────────────────────────────────────────────────
function renderTicketList(tickets, editMode) {
  const container = document.getElementById('ticketList');
  if (!container) return;
  container.innerHTML = '';

  tickets.forEach((ticket, i) => {
    const div = document.createElement('div');
    div.className = 't-card';
    div.dataset.ticketId = ticket.id;

    if (editMode) {
      div.innerHTML = `
        <div class="t-card-header">
          <span class="t-card-title">Ticket ${i + 1}</span>
          ${!currentOrder.paid
            ? `<button class="btn btn-danger btn-sm delete-ticket-btn">Entfernen</button>`
            : ''}
        </div>
        <div class="edit-form-row">
          <div class="form-group" style="margin-bottom:0">
            <label>Name</label>
            <input class="edit-name" type="text" value="${esc(ticket.ticket_name)}" required>
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label>E-Mail</label>
            <input class="edit-email" type="email" value="${esc(ticket.ticket_email || '')}" required>
          </div>
        </div>
        <div class="edit-actions">
          <button class="btn btn-primary btn-sm save-ticket-btn">Speichern</button>
          <span class="ticket-feedback"></span>
        </div>
      `;
      div.querySelector('.save-ticket-btn').addEventListener('click', () => saveTicket(div, ticket));
      const del = div.querySelector('.delete-ticket-btn');
      if (del) del.addEventListener('click', () => confirmDeleteTicket(ticket, i));
    } else {
      div.innerHTML = `
        <div class="t-card-header">
          <span class="t-card-title">Ticket ${i + 1}</span>
        </div>
        <div class="t-meta">${esc(ticket.ticket_name)}</div>
        <div class="t-meta">${esc(ticket.ticket_email || '–')}</div>
        ${ticket.split_ref ? `<div class="t-meta">Referenz:&nbsp;<code>${esc(ticket.split_ref)}</code></div>` : ''}
      `;
    }
    container.appendChild(div);
  });
}

// ── Ticket löschen ────────────────────────────────────────────────────────
async function confirmDeleteTicket(ticket, index) {
  const manageAlert = document.getElementById('manageAlertBox');
  if (currentTickets.length <= 1) {
    showAlert(manageAlert, 'Mindestens ein Ticket muss in der Bestellung verbleiben.', 'warning');
    return;
  }
  if (!confirm(`Ticket ${index + 1} (${ticket.ticket_name}) wirklich entfernen?`)) return;

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
    showAlert(manageAlert, 'Ticket erfolgreich entfernt.', 'success');
  } catch { showAlert(manageAlert, 'Verbindungsfehler.', 'danger'); }
}

// ── Ticket speichern ──────────────────────────────────────────────────────
async function saveTicket(div, ticket) {
  const nameInput  = div.querySelector('.edit-name');
  const emailInput = div.querySelector('.edit-email');
  const feedback   = div.querySelector('.ticket-feedback');
  const saveBtn    = div.querySelector('.save-ticket-btn');

  const ticketName  = nameInput.value.trim();
  const ticketEmail = emailInput.value.trim();

  if (!ticketName) { feedback.innerHTML = '<span class="feedback-err">Name darf nicht leer sein.</span>'; return; }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ticketEmail)) {
    feedback.innerHTML = '<span class="feedback-err">Ungültige E-Mail-Adresse.</span>'; return;
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
    if (!res.ok) { feedback.innerHTML = `<span class="feedback-err">${esc(data.error)}</span>`; return; }

    ticket.ticket_name  = ticketName;
    ticket.ticket_email = ticketEmail;
    feedback.innerHTML  = '<span class="feedback-ok">Gespeichert</span>';

    const manageAlert = document.getElementById('manageAlertBox');
    if (data.paid && (data.nameChanged || data.emailChanged)) {
      if (data.emailResent) {
        showAlert(manageAlert, 'Angaben geändert – ein aktualisiertes Ticket wurde an die neue E-Mail-Adresse gesendet.', 'success');
      } else {
        showAlert(manageAlert, 'Angaben geändert, aber E-Mail-Versand fehlgeschlagen. Bitte Orga-Team kontaktieren.', 'warning');
      }
    }
  } catch { feedback.innerHTML = '<span class="feedback-err">Verbindungsfehler.</span>'; }
  finally {
    saveBtn.disabled    = false;
    saveBtn.textContent = 'Speichern';
  }
}

// ── Ticket-Formulare (fresh order) ────────────────────────────────────────
function buildTicketForms(count) {
  ticketForms.innerHTML = '';

  const hint = document.createElement('p');
  hint.style.cssText = 'color:var(--muted);font-size:.875rem;margin-bottom:.85rem';
  hint.textContent = `Du kannst 1 bis ${count} Ticket(s) bestellen. Optionale Felder leer lassen = nicht berechnet.`;
  ticketForms.appendChild(hint);

  for (let i = 1; i <= count; i++) {
    const div = document.createElement('div');
    div.className = 'card';
    div.style.cssText = 'background:var(--card-2);box-shadow:none;padding:1rem;margin-bottom:.75rem;border:1.5px solid var(--border)';
    div.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.6rem">
        <strong style="font-size:.95rem">Ticket ${i}</strong>
        ${i > 1 ? `<span style="font-size:.78rem;color:var(--muted);font-weight:500">optional</span>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
        <div class="form-group" style="margin-bottom:0">
          <label for="ticketName${i}">Name${i === 1 ? ' *' : ''}</label>
          <input id="ticketName${i}" type="text" name="ticketName"
            placeholder="Vollständiger Name" ${i === 1 ? 'required' : ''} autocomplete="name">
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label for="ticketEmail${i}">E-Mail${i === 1 ? ' *' : ''}</label>
          <input id="ticketEmail${i}" type="email" name="ticketEmail"
            placeholder="name@beispiel.de" ${i === 1 ? 'required' : ''} autocomplete="email">
        </div>
      </div>
    `;
    ticketForms.appendChild(div);
  }

  ticketForms.querySelectorAll('[name=ticketName]').forEach(inp => inp.addEventListener('input', updateTotal));
  updateTotal();
}

function updateTotal() {
  if (!config) return;
  let filledCount = 0;
  ticketForms.querySelectorAll('.card').forEach(f => {
    const n = f.querySelector('[name=ticketName]');
    if (n && n.value.trim()) filledCount++;
  });
  const count = filledCount || (person ? 1 : 0);
  if (totalPrice) totalPrice.textContent = fmt(count * config.price);
}

// ── Bestellung absenden ───────────────────────────────────────────────────
submitBtn.addEventListener('click', async () => {
  alertBox.innerHTML = '';
  const tickets = [];
  const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  for (const form of ticketForms.querySelectorAll('.card')) {
    const nameInput  = form.querySelector('[name=ticketName]');
    const emailInput = form.querySelector('[name=ticketEmail]');
    if (!nameInput || !emailInput) continue;
    const name  = nameInput.value.trim();
    const email = emailInput.value.trim();
    if (!name && !email) continue;
    if (!name)  { showAlert(alertBox, 'Bitte den Namen für jedes begonnene Ticket ausfüllen.'); nameInput.focus(); return; }
    if (!email || !emailRe.test(email)) {
      showAlert(alertBox, 'Bitte eine gültige E-Mail-Adresse eingeben.'); emailInput.focus(); return;
    }
    tickets.push({ ticketName: name, ticketEmail: email });
  }

  if (tickets.length === 0) { showAlert(alertBox, 'Bitte mindestens ein Ticket ausfüllen.'); return; }

  submitBtn.disabled  = true;
  submitBtn.innerHTML = '<span class="spinner"></span> Sende…';

  try {
    const res  = await fetch('/api/tickets/order', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personId: person.id, code, tickets }),
    });
    const data = await res.json();

    if (res.status === 409) {
      showAlert(alertBox,
        'Du hast bereits eine Bestellung. ' +
        `<a href="/order.html?personId=${person.id}&code=${encodeURIComponent(code)}&mode=manage">Hier einsehen &rarr;</a>`,
        'warning'
      );
      return;
    }
    if (!res.ok) { showAlert(alertBox, data.error || 'Fehler beim Absenden.'); return; }

    currentOrder   = { id: data.orderId, total_eur: data.totalEur, paid: 0, split_payment: 0 };
    currentTickets = tickets.map(t => ({ id: null, ticket_name: t.ticketName, ticket_email: t.ticketEmail }));

    orderCard.style.display   = 'none';
    paymentCard.style.display = 'block';

    // Reload fresh from server so ticket QR tokens are initialized
    const freshRes  = await fetch(`/api/tickets/my-order?code=${encodeURIComponent(code)}`);
    const freshData = await freshRes.json();
    if (freshRes.ok) {
      currentOrder   = freshData.order;
      currentTickets = freshData.tickets;
      renderManage(freshData);
    } else {
      // Fallback: zeige nur Zahlungsinfo ohne Tabs
      injectManageStyles();
      paymentCard.innerHTML = `
        <div class="pay-box">
          <div class="pay-box-header">Zahlungsdetails</div>
          <div class="pay-row"><span class="pay-row-label">Betrag</span><span class="pay-row-value pay-amount">${fmt(data.totalEur)}</span></div>
          <div class="pay-row"><span class="pay-row-label">Empfänger</span><span class="pay-row-value">${esc(config.accountName)}</span></div>
          <div class="pay-row"><span class="pay-row-label">IBAN</span><span class="pay-row-value"><code>${esc(config.iban)}</code></span></div>
          <div class="pay-row"><span class="pay-row-label">Verwendungszweck</span><span class="pay-row-value"><code>${esc(data.reference)}</code></span></div>
        </div>
        ${data.epcQr ? `
          <div class="qr-block">
            <span class="qr-block-title">GiroCode – Banking-App scannen</span>
            <img src="${data.epcQr}" alt="Zahlung QR-Code" width="192" height="192">
            <span class="qr-block-label">${esc(data.reference)}</span>
          </div>` : ''}
      `;
    }
  } catch { showAlert(alertBox, 'Verbindungsfehler. Bitte versuche es erneut.'); }
  finally {
    submitBtn.disabled  = false;
    submitBtn.innerHTML = 'Bestellung absenden &amp; Zahlungsinfo erhalten';
  }
});

init();
