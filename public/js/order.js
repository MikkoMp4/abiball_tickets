/* order.js – Bestellseite */

const params   = new URLSearchParams(window.location.search);
const personId = params.get('personId');
const code     = params.get('code');
const mode     = params.get('mode'); // 'manage' when re-entering an existing code

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

let person = null;
let config = null;
let currentOrder = null;   // set in manage mode
let currentTickets = [];   // set in manage mode

function showAlert(box, msg, type = 'danger') {
  box.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
}

function fmt(eur) {
  return eur.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Initialisierung ────────────────────────────────────────────────
async function init() {
  if (!personId) {
    window.location.href = '/';
    return;
  }

  try {
    const cfgRes = await fetch('/api/tickets/config');
    config = await cfgRes.json();

    if (pricePerTicket) pricePerTicket.textContent = fmt(config.price);

    if (config.event) {
      document.title = `${config.event} – Ticketbestellung`;
      const navH1 = document.querySelector('.topbar h1');
      if (navH1) navH1.textContent = `\uD83C\uDF93 ${config.event}`;
    }

    // Personendaten via Code-Verifikation laden
    const verifyRes = await fetch('/api/codes/verify', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ code }),
    });
    const verifyData = await verifyRes.json();

    if (!verifyRes.ok) {
      personInfo.textContent = 'Ungültiger Zugangscode.';
      return;
    }

    person = verifyData.person;

    if (mode === 'manage' || verifyData.alreadyOrdered) {
      // ---- MANAGE MODE ----
      personInfo.innerHTML =
        `<strong>${esc(person.name)}</strong> &nbsp;|&nbsp; Code: <code>${esc(code)}</code>`;
      await loadManageMode();
      return;
    }

    // ---- FRESH ORDER MODE ----
    personInfo.innerHTML =
      `<strong>${esc(person.name)}</strong> &nbsp;|&nbsp; Zugangscode: <code>${esc(code)}</code> &nbsp;|&nbsp; ` +
      `Verfügbare Tickets: <strong>${esc(String(person.num_tickets))}</strong>`;

    buildTicketForms(person.num_tickets);
    orderCard.style.display = 'block';

  } catch (err) {
    personInfo.textContent = 'Fehler beim Laden. Bitte Seite neu laden.';
  }
}

// ── Manage-Mode: bestehende Bestellung laden und anzeigen ────────────────────
async function loadManageMode() {
  try {
    const res  = await fetch(`/api/tickets/my-order?code=${encodeURIComponent(code)}`);
    const data = await res.json();

    if (!res.ok) {
      showAlert(alertBox, data.error || 'Bestellung nicht gefunden.', 'warning');
      return;
    }

    currentOrder   = data.order;
    currentTickets = data.tickets;

    // Show payment card with existing info
    orderCard.style.display   = 'none';
    paymentCard.style.display = 'block';

    document.getElementById('payAmount').textContent = fmt(data.order.total_eur);
    document.getElementById('payIban').textContent   = data.config.iban;
    document.getElementById('payName').textContent   = data.config.accountName;
    document.getElementById('payRef').textContent    = data.reference;

    if (data.epcQr) {
      const img = document.getElementById('epcQrImg');
      if (img) { img.src = data.epcQr; img.style.display = 'block'; }
    }

    // Paid status badge
    const paidBadge = data.order.paid
      ? '<span class="badge" style="background:#27ae60;color:#fff;margin-left:.5rem">✓ Bezahlt</span>'
      : '<span class="badge" style="background:#e67e22;color:#fff;margin-left:.5rem">Ausstehend</span>';

    // Inject edit button and ticket list below payment card
    let editSection = document.getElementById('editSection');
    if (!editSection) {
      editSection = document.createElement('div');
      editSection.id = 'editSection';
      editSection.style.cssText = 'margin-top:1.5rem';
      paymentCard.after(editSection);
    }

    editSection.innerHTML = `
      <div class="card" style="margin-top:1rem">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem">
          <h3 style="margin:0">Deine Tickets ${paidBadge}</h3>
          <button id="toggleEditBtn" class="btn btn-primary" style="min-width:160px">✏️ Angaben ändern</button>
        </div>
        <div id="manageAlertBox" style="margin-top:.75rem"></div>
        <div id="ticketList" style="margin-top:1rem"></div>
      </div>
    `;

    renderTicketList(currentTickets, false);

    document.getElementById('toggleEditBtn').addEventListener('click', () => {
      const editing = document.getElementById('toggleEditBtn').dataset.editing === 'true';
      renderTicketList(currentTickets, !editing);
      document.getElementById('toggleEditBtn').dataset.editing = String(!editing);
      document.getElementById('toggleEditBtn').textContent = !editing ? '✕ Abbrechen' : '✏️ Angaben ändern';
    });

  } catch (err) {
    showAlert(alertBox, 'Verbindungsfehler beim Laden der Bestellung.', 'danger');
  }
}

// ── Ticket-Liste rendern (read-only oder edit mode) ──────────────────────────
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
        <strong>Ticket ${i + 1}</strong>
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
          ${tickets.length > 1
            ? `<button class="btn btn-danger delete-ticket-btn" style="min-width:100px">🗑 Löschen</button>`
            : '<button class="btn" disabled style="min-width:100px;opacity:.4">🗑 Löschen</button>'}
        </div>
        <div class="ticket-feedback" style="margin-top:.5rem"></div>
      `;

      div.querySelector('.save-ticket-btn').addEventListener('click', () => saveTicket(div, ticket));
      const delBtn = div.querySelector('.delete-ticket-btn');
      if (delBtn && !delBtn.disabled) delBtn.addEventListener('click', () => deleteTicket(div, ticket));

    } else {
      div.innerHTML = `
        <strong>Ticket ${i + 1}</strong>
        <div style="margin-top:.4rem;color:#555">
          <div>👤 ${esc(ticket.ticket_name)}</div>
          <div>📧 ${esc(ticket.ticket_email || '–')}</div>
        </div>
      `;
    }

    container.appendChild(div);
  });
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

  saveBtn.disabled = true;
  saveBtn.textContent = 'Speichere…';
  feedback.innerHTML  = '';

  try {
    const res = await fetch(
      `/api/tickets/order/${currentOrder.id}/ticket/${ticket.id}`,
      {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code, ticketName, ticketEmail }),
      }
    );
    const data = await res.json();

    if (!res.ok) {
      feedback.innerHTML = `<span style="color:red">${esc(data.error)}</span>`;
      return;
    }

    // Update local state
    ticket.ticket_name  = ticketName;
    ticket.ticket_email = ticketEmail;

    feedback.innerHTML = '<span style="color:green">✓ Gespeichert</span>';

    if (data.emailChanged && data.paid) {
      showAlert(
        document.getElementById('manageAlertBox'),
        'Die E-Mail-Adresse hat sich geändert. Bitte das Komitee informieren, damit das Ticket erneut gesendet wird.',
        'warning'
      );
    }

  } catch {
    feedback.innerHTML = '<span style="color:red">Verbindungsfehler.</span>';
  } finally {
    saveBtn.disabled    = false;
    saveBtn.textContent = '✓ Speichern';
  }
}

// ── Ticket löschen (DELETE) ────────────────────────────────────────────
async function deleteTicket(div, ticket) {
  if (!confirm(`Ticket für "${ticket.ticket_name}" wirklich löschen?`)) return;

  const feedback = div.querySelector('.ticket-feedback');

  try {
    const res = await fetch(
      `/api/tickets/order/${currentOrder.id}/ticket/${ticket.id}`,
      {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code }),
      }
    );
    const data = await res.json();

    if (!res.ok) {
      if (feedback) feedback.innerHTML = `<span style="color:red">${esc(data.error)}</span>`;
      else alert(data.error);
      return;
    }

    // Remove from local state and re-render
    currentTickets = currentTickets.filter(t => t.id !== ticket.id);
    currentOrder.total_eur = data.newTotalEur;

    // Update displayed total
    document.getElementById('payAmount').textContent = fmt(data.newTotalEur);

    renderTicketList(currentTickets, true);

    // Keep edit mode toggle consistent
    const toggleBtn = document.getElementById('toggleEditBtn');
    if (toggleBtn) {
      toggleBtn.dataset.editing = 'true';
      toggleBtn.textContent = '✕ Abbrechen';
    }

  } catch {
    if (feedback) feedback.innerHTML = '<span style="color:red">Verbindungsfehler.</span>';
  }
}

// ── Ticket-Formulare aufbauen (fresh order) ────────────────────────────
function buildTicketForms(count) {
  ticketForms.innerHTML = '';
  for (let i = 1; i <= count; i++) {
    const div = document.createElement('div');
    div.className = 'card';
    div.style.cssText = 'background:#f9f9f9;box-shadow:none;padding:1rem;margin-bottom:.75rem;';
    div.innerHTML = `
      <strong>Ticket ${i}</strong>
      <div class="form-group" style="margin-top:.5rem">
        <label for="ticketName${i}">Name der Person *</label>
        <input id="ticketName${i}" type="text" name="ticketName"
          placeholder="Vollständiger Name" required autocomplete="name">
      </div>
      <div class="form-group">
        <label for="ticketEmail${i}">E-Mail-Adresse *</label>
        <input id="ticketEmail${i}" type="email" name="ticketEmail"
          placeholder="name@beispiel.de" required autocomplete="email">
      </div>
    `;
    ticketForms.appendChild(div);
  }
  updateTotal();
}

function updateTotal() {
  if (config) {
    const count = person ? person.num_tickets : 0;
    totalPrice.textContent = fmt(count * config.price);
  }
}

// ── Bestellung absenden ────────────────────────────────────────────────
submitBtn.addEventListener('click', async () => {
  alertBox.innerHTML = '';

  const tickets = [];
  const forms = ticketForms.querySelectorAll('.card');
  for (const form of forms) {
    const nameInput  = form.querySelector('[name=ticketName]');
    const emailInput = form.querySelector('[name=ticketEmail]');
    const name  = nameInput?.value.trim();
    const email = emailInput?.value.trim();

    if (!name) {
      showAlert(alertBox, 'Bitte alle Ticket-Namen ausfüllen.');
      nameInput.focus();
      return;
    }
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      showAlert(alertBox, 'Bitte eine gültige E-Mail-Adresse für jedes Ticket eingeben.');
      emailInput.focus();
      return;
    }

    tickets.push({
      ticketName:  name,
      ticketEmail: email,
    });
  }

  // Prevent double-click / double-tap race from the same browser
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner"></span> Sende…';

  try {
    const res  = await fetch('/api/tickets/order', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ personId: person.id, tickets }),
    });
    const data = await res.json();

    if (res.status === 409) {
      // Another tab or person already submitted with this code – go to manage mode
      showAlert(alertBox,
        'Du hast bereits eine Bestellung abgesendet. <a href="' +
        `/order.html?personId=${person.id}&code=${encodeURIComponent(code)}&mode=manage` +
        '">Hier einzusehen →</a>',
        'warning'
      );
      return;
    }

    if (!res.ok) {
      showAlert(alertBox, data.error || 'Fehler beim Absenden.');
      return;
    }

    // Zahlungsinfo anzeigen
    orderCard.style.display   = 'none';
    paymentCard.style.display = 'block';

    document.getElementById('payAmount').textContent = fmt(data.totalEur);
    document.getElementById('payIban').textContent   = config.iban;
    document.getElementById('payName').textContent   = config.accountName;
    document.getElementById('payRef').textContent    = data.reference;

    if (data.epcQr) {
      const img = document.getElementById('epcQrImg');
      if (img) { img.src = data.epcQr; img.style.display = 'block'; }
    }

  } catch {
    showAlert(alertBox, 'Verbindungsfehler. Bitte versuche es erneut.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = 'Bestellung absenden &amp; Zahlungsinfo erhalten';
  }
});

init();
