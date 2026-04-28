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
  return eur.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
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
      if (navH1) navH1.textContent = `🎓 ${config.event}`;
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
      // Keine Bestellung vorhanden → frisches Formular zeigen
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

    renderPaymentInfo(data);
    renderEditSection(data);

  } catch (err) {
    showAlert(alertBox, 'Verbindungsfehler beim Laden der Bestellung.', 'danger');
  }
}

// ── Zahlungsinfo rendern ──────────────────────────────────────────────────
function renderPaymentInfo(data) {
  document.getElementById('payAmount').textContent = fmt(data.order.total_eur);
  document.getElementById('payIban').textContent   = data.config.iban;
  document.getElementById('payName').textContent   = data.config.accountName;
  document.getElementById('payRef').textContent    = data.reference;

  // Haupt-EPC-QR (Gesamtzahlung)
  const epcBlock = document.getElementById('epcBlock');
  if (epcBlock) epcBlock.style.display = data.order.split_payment ? 'none' : '';
  if (data.epcQr && !data.order.split_payment) {
    const img = document.getElementById('epcQrImg');
    if (img) { img.src = data.epcQr; img.style.display = 'block'; }
  }

  // Split-Zahlungsinfos pro Ticket
  let splitBlock = document.getElementById('splitBlock');
  if (!splitBlock) {
    splitBlock = document.createElement('div');
    splitBlock.id = 'splitBlock';
    paymentCard.querySelector('.card-body, .card') && paymentCard.appendChild(splitBlock);
  }
  splitBlock.innerHTML = '';

  if (data.order.split_payment) {
    splitBlock.innerHTML = `<p style="margin-top:1rem"><strong>💳 Separat zahlen – jede Person zahlt ihr eigenes Ticket:</strong></p>`;
    data.tickets.forEach((t, i) => {
      if (!t.split_ref) return;
      splitBlock.innerHTML += `
        <div class="card" style="background:#f9f9f9;box-shadow:none;padding:1rem;margin-bottom:.5rem">
          <strong>Ticket ${i + 1} – ${esc(t.ticket_name)}</strong>
          <div style="margin-top:.5rem;font-size:.9rem">
            <div>Betrag: <strong>${fmt(data.config.price)}</strong></div>
            <div>Referenz: <code>${esc(t.split_ref)}</code></div>
          </div>
          ${t.splitEpcQr ? `<img src="${t.splitEpcQr}" alt="QR ${i+1}" style="margin-top:.5rem;max-width:160px">` : ''}
        </div>
      `;
    });
  }
}

// ── Edit-Sektion rendern ──────────────────────────────────────────────────
function renderEditSection(data) {
  const paidBadge = data.order.paid
    ? '<span class="badge" style="background:#27ae60;color:#fff;margin-left:.5rem">✓ Bezahlt</span>'
    : '<span class="badge" style="background:#e67e22;color:#fff;margin-left:.5rem">Ausstehend</span>';

  let editSection = document.getElementById('editSection');
  if (!editSection) {
    editSection = document.createElement('div');
    editSection.id = 'editSection';
    editSection.style.cssText = 'margin-top:1.5rem';
    paymentCard.after(editSection);
  }

  const canAdd = !data.order.paid && data.remainingSlots > 0;

  editSection.innerHTML = `
    <div class="card" style="margin-top:1rem">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem">
        <h3 style="margin:0">Deine Tickets ${paidBadge}</h3>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          ${canAdd ? `<button id="addTicketBtn" class="btn btn-secondary" style="min-width:140px">➕ Ticket hinzufügen</button>` : ''}
          <button id="toggleEditBtn" class="btn btn-primary" style="min-width:160px">✏️ Angaben ändern</button>
        </div>
      </div>
      <div id="manageAlertBox" style="margin-top:.75rem"></div>
      <div id="ticketList" style="margin-top:1rem"></div>
      ${canAdd ? `
        <div id="addTicketForm" style="display:none;margin-top:1rem;padding:1rem;background:#f0f7ff;border-radius:8px">
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
            <button id="addTicketSaveBtn" class="btn btn-primary">✓ Hinzufügen</button>
            <button id="addTicketCancelBtn" class="btn btn-secondary">Abbrechen</button>
          </div>
          <div id="addTicketFeedback" style="margin-top:.5rem"></div>
        </div>
      ` : ''}
    </div>
  `;

  renderTicketList(currentTickets, false);

  document.getElementById('toggleEditBtn').addEventListener('click', () => {
    const btn     = document.getElementById('toggleEditBtn');
    const editing = btn.dataset.editing === 'true';
    renderTicketList(currentTickets, !editing);
    btn.dataset.editing = String(!editing);
    btn.textContent = !editing ? '✕ Abbrechen' : '✏️ Angaben ändern';
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
  saveBtn.textContent = 'Hinzufüge…';
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

    // Gesamtpreis aktualisieren
    const payAmountEl = document.getElementById('payAmount');
    if (payAmountEl) payAmountEl.textContent = fmt(data.newTotalEur);

    // Split-QR aktualisieren falls vorhanden
    if (data.splitRef && data.splitEpcQr) {
      const splitBlock = document.getElementById('splitBlock');
      if (splitBlock) {
        const t = data.ticket;
        splitBlock.innerHTML += `
          <div class="card" style="background:#f9f9f9;box-shadow:none;padding:1rem;margin-bottom:.5rem">
            <strong>Ticket ${currentTickets.length} – ${esc(t.ticket_name)}</strong>
            <div style="margin-top:.5rem;font-size:.9rem">
              <div>Betrag: <strong>${fmt(config.price)}</strong></div>
              <div>Referenz: <code>${esc(data.splitRef)}</code></div>
            </div>
            <img src="${data.splitEpcQr}" alt="QR" style="margin-top:.5rem;max-width:160px">
          </div>
        `;
      }
    }

    // Form zurücksetzen
    nameInput.value  = '';
    emailInput.value = '';
    document.getElementById('addTicketForm').style.display = 'none';
    document.getElementById('addTicketBtn').style.display  = '';

    renderTicketList(currentTickets, false);
    const manageAlert = document.getElementById('manageAlertBox');
    showAlert(manageAlert, '✓ Ticket erfolgreich hinzugefügt.', 'success');

  } catch {
    feedback.innerHTML = '<span style="color:red">Verbindungsfehler.</span>';
  } finally {
    saveBtn.disabled    = false;
    saveBtn.textContent = '✓ Hinzufügen';
  }
}

// ── Ticket-Liste rendern ─────────────────────────────────────────────────────
function renderTicketList(tickets, editMode) {
  const container = document.getElementById('ticketList');
  if (!container) return;
  container.innerHTML = '';

  tickets.forEach((ticket, i) => {
    const div = document.createElement('div');
    div.className = 'card';
    div.style.cssText = 'background:#f9f9f9;box-shadow:none;padding:1rem;margin-bottom:.75rem';
    div.dataset.ticketId = ticket.id;

    if (editMode) {
      div.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem">
          <strong>Ticket ${i + 1}</strong>
          ${!currentOrder.paid ? `<button class="btn btn-danger delete-ticket-btn" style="padding:.25rem .75rem;font-size:.85rem" title="Ticket löschen">🗑 Löschen</button>` : ''}
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
          <button class="btn btn-primary save-ticket-btn" style="min-width:100px">✓ Speichern</button>
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
          <div>👤 ${esc(ticket.ticket_name)}</div>
          <div>📧 ${esc(ticket.ticket_email || '–')}</div>
          ${ticket.split_ref ? `<div style="margin-top:.25rem;font-size:.85rem">🔖 Referenz: <code>${esc(ticket.split_ref)}</code></div>` : ''}
        </div>
      `;
    }
    container.appendChild(div);
  });
}

// ── Ticket löschen (user-seitig) ─────────────────────────────────────────────
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
      showAlert(manageAlert, '⛔ Diese Bestellung wurde bereits bezahlt. Bitte wende dich an das Orga-Team.', 'danger');
      return;
    }
    if (res.status === 409 && data.error === 'last_ticket') {
      showAlert(manageAlert, 'Mindestens ein Ticket muss verbleiben.', 'warning');
      return;
    }
    if (!res.ok) { showAlert(manageAlert, data.error || 'Fehler beim Löschen.', 'danger'); return; }

    currentTickets = currentTickets.filter(t => t.id !== ticket.id);
    currentOrder.total_eur = data.newTotalEur;

    const payAmountEl = document.getElementById('payAmount');
    if (payAmountEl) payAmountEl.textContent = fmt(data.newTotalEur);

    renderTicketList(currentTickets, true);
    showAlert(manageAlert, '✓ Ticket erfolgreich gelöscht.', 'success');

  } catch { showAlert(manageAlert, 'Verbindungsfehler beim Löschen.', 'danger'); }
}

// ── Ticket speichern (PATCH) ─────────────────────────────────────────────────
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
    if (data.emailChanged && data.paid) {
      if (data.emailResent) {
        showAlert(manageAlert, '📧 E-Mail-Adresse geändert – ein aktualisiertes Ticket wurde automatisch an die neue Adresse gesendet.', 'success');
      } else {
        showAlert(manageAlert, '⚠️ E-Mail-Adresse geändert, aber Versenden fehlgeschlagen. Bitte Orga-Team kontaktieren.', 'warning');
      }
    }
  } catch { feedback.innerHTML = '<span style="color:red">Verbindungsfehler.</span>'; }
  finally {
    saveBtn.disabled    = false;
    saveBtn.textContent = '✓ Speichern';
  }
}

// ── Ticket-Formulare aufbauen (fresh order) ──────────────────────────────────
function buildTicketForms(count) {
  ticketForms.innerHTML = '';

  // Hinweistext: optionale Felder
  const hint = document.createElement('p');
  hint.style.cssText = 'color:#666;font-size:.9rem;margin-bottom:.75rem';
  hint.textContent = `Du kannst 1 bis ${count} Ticket(s) bestellen. Felder die du leer lässt werden nicht berechnet.`;
  ticketForms.appendChild(hint);

  // Split-Payment Toggle
  const splitRow = document.createElement('div');
  splitRow.style.cssText = 'margin-bottom:1rem;display:flex;align-items:center;gap:.5rem';
  splitRow.innerHTML = `
    <input type="checkbox" id="splitPaymentToggle" style="width:18px;height:18px;cursor:pointer">
    <label for="splitPaymentToggle" style="cursor:pointer;margin:0">
      💳 <strong>Separat zahlen</strong> – jede Person überweist ihr Ticket einzeln
      <span style="font-size:.82rem;color:#666">(Referenz bekommt -1, -2, … Suffix)</span>
    </label>
  `;
  ticketForms.appendChild(splitRow);

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

  // Dynamischer Gesamtpreis
  const allNameInputs = ticketForms.querySelectorAll('[name=ticketName]');
  allNameInputs.forEach(inp => inp.addEventListener('input', updateTotal));
  updateTotal();
}

function updateTotal() {
  if (!config) return;
  // Zähle Tickets mit ausgefülltem Namen
  const forms      = ticketForms.querySelectorAll('.card');
  let filledCount  = 0;
  forms.forEach(f => {
    const n = f.querySelector('[name=ticketName]');
    if (n && n.value.trim()) filledCount++;
  });
  const count = filledCount || (person ? 1 : 0);
  if (totalPrice) totalPrice.textContent = fmt(count * config.price);
}

// ── Bestellung absenden ──────────────────────────────────────────────────────
submitBtn.addEventListener('click', async () => {
  alertBox.innerHTML = '';
  const tickets = [];
  const forms   = ticketForms.querySelectorAll('.card');
  const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const splitPayment = document.getElementById('splitPaymentToggle')?.checked || false;

  for (const form of forms) {
    const nameInput  = form.querySelector('[name=ticketName]');
    const emailInput = form.querySelector('[name=ticketEmail]');
    if (!nameInput || !emailInput) continue;
    const name  = nameInput.value.trim();
    const email = emailInput.value.trim();

    // Leere Felder überspringen (optionale Tickets)
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
      body: JSON.stringify({ personId: person.id, tickets, splitPayment }),
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

    orderCard.style.display   = 'none';
    paymentCard.style.display = 'block';

    document.getElementById('payAmount').textContent = fmt(data.totalEur);
    document.getElementById('payIban').textContent   = config.iban;
    document.getElementById('payName').textContent   = config.accountName;
    document.getElementById('payRef').textContent    = data.reference;

    // Haupt-EPC-QR
    const epcBlock = document.getElementById('epcBlock');
    if (epcBlock) epcBlock.style.display = data.splitPayment ? 'none' : '';
    if (data.epcQr && !data.splitPayment) {
      const img = document.getElementById('epcQrImg');
      if (img) { img.src = data.epcQr; img.style.display = 'block'; }
    }

    // Split-Infos anzeigen
    if (data.splitPayment && data.splitEpcQrs && data.splitEpcQrs.length) {
      let splitBlock = document.getElementById('splitBlock');
      if (!splitBlock) {
        splitBlock = document.createElement('div');
        splitBlock.id = 'splitBlock';
        paymentCard.appendChild(splitBlock);
      }
      splitBlock.innerHTML = `<p style="margin-top:1rem"><strong>💳 Separat zahlen – jede Person zahlt ihr eigenes Ticket:</strong></p>`;
      data.splitEpcQrs.forEach((s, i) => {
        splitBlock.innerHTML += `
          <div class="card" style="background:#f9f9f9;box-shadow:none;padding:1rem;margin-bottom:.5rem">
            <strong>Ticket ${i + 1} – ${esc(tickets[i].ticketName)}</strong>
            <div style="margin-top:.5rem;font-size:.9rem">
              <div>Betrag: <strong>${fmt(config.price)}</strong></div>
              <div>Referenz: <code>${esc(s.ref)}</code></div>
            </div>
            ${s.qr ? `<img src="${s.qr}" alt="QR ${i+1}" style="margin-top:.5rem;max-width:160px">` : ''}
          </div>
        `;
      });
    }

    currentOrder   = { id: data.orderId, total_eur: data.totalEur, paid: 0, split_payment: data.splitPayment ? 1 : 0 };
    currentTickets = tickets.map(t => ({ id: null, ticket_name: t.ticketName, ticket_email: t.ticketEmail }));

  } catch { showAlert(alertBox, 'Verbindungsfehler. Bitte versuche es erneut.'); }
  finally {
    submitBtn.disabled  = false;
    submitBtn.innerHTML = 'Bestellung absenden &amp; Zahlungsinfo erhalten';
  }
});

init();
