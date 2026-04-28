/* order.js – Bestellseite */

const params   = new URLSearchParams(window.location.search);
const personId = params.get('personId');
const code     = params.get('code');

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

// ── Initialisierung ──────────────────────────────────────────────────────────
async function init() {
  if (!personId) {
    window.location.href = '/';
    return;
  }

  try {
    // Ticket-Konfiguration laden
    const cfgRes = await fetch('/api/tickets/config');
    config = await cfgRes.json();

    pricePerTicket.textContent = fmt(config.price);

    // Update page branding from config
    if (config.event) {
      document.title = `${config.event} – Ticketbestellung`;
      const navH1 = document.querySelector('.topbar h1');
      if (navH1) navH1.textContent = `🎓 ${config.event}`;
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

    if (verifyData.alreadyOrdered) {
      personInfo.textContent = `${person.name} – Bestellung bereits aufgegeben.`;
      showAlert(alertBox, 'Du hast bereits eine Bestellung abgesendet. Bei Fragen wende dich ans Komitee.', 'warning');
      return;
    }

    personInfo.innerHTML =
      `<strong>${esc(person.name)}</strong> &nbsp;|&nbsp; Zugangscode: <code>${esc(code)}</code> &nbsp;|&nbsp; ` +
      `Verfügbare Tickets: <strong>${esc(String(person.num_tickets))}</strong>`;

    buildTicketForms(person.num_tickets);
    orderCard.style.display = 'block';

  } catch (err) {
    personInfo.textContent = 'Fehler beim Laden. Bitte Seite neu laden.';
  }
}

// ── Ticket-Formulare aufbauen ────────────────────────────────────────────────
// Each ticket only needs: Name + E-Mail (no class, no extraInfo)
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

// ── Bestellung absenden ──────────────────────────────────────────────────────
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

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner"></span> Sende…';

  try {
    const res  = await fetch('/api/tickets/order', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ personId: person.id, tickets }),
    });
    const data = await res.json();

    if (!res.ok) {
      showAlert(alertBox, data.error || 'Fehler beim Absenden.');
      return;
    }

    // Zahlungsinfo anzeigen
    orderCard.style.display = 'none';
    paymentCard.style.display = 'block';

    document.getElementById('payAmount').textContent = fmt(data.totalEur);
    document.getElementById('payIban').textContent   = config.iban;
    document.getElementById('payName').textContent   = config.accountName;
    document.getElementById('payRef').textContent    = data.reference;

    if (data.epcQr) {
      const img = document.getElementById('epcQrImg');
      img.src   = data.epcQr;
      img.style.display = 'block';
    }

  } catch {
    showAlert(alertBox, 'Verbindungsfehler. Bitte versuche es erneut.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = 'Bestellung absenden &amp; Zahlungsinfo erhalten';
  }
});

init();
