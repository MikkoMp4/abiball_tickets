/* main.js – Startseite: Code-Eingabe und Weiterleitung */

const codeInput = document.getElementById('codeInput');
const verifyBtn = document.getElementById('verifyBtn');
const alertBox  = document.getElementById('alertBox');

// Update page branding dynamically from server config
fetch('/api/tickets/config')
  .then(r => r.json())
  .then(cfg => {
    if (!cfg.event) return;
    document.title = `${cfg.event} – Ticketkauf`;
    const navH1 = document.querySelector('.topbar h1');
    if (navH1) navH1.textContent = `Abiball 2026 MTG`;
    const heroH1 = document.querySelector('.hero h1');
    if (heroH1) heroH1.textContent = `Willkommen zum Ticketverkauf von unserem ${cfg.event}`;
  })
  .catch(() => {});

function showAlert(msg, type = 'danger') {
  alertBox.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
}

// Code auto-formatieren: nach 4 Zeichen Bindestrich einfügen
codeInput.addEventListener('input', () => {
  let val = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (val.length > 4) val = val.slice(0, 4) + '-' + val.slice(4, 8);
  codeInput.value = val;
});

codeInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') verifyBtn.click();
});

verifyBtn.addEventListener('click', async () => {
  const code = codeInput.value.trim().toUpperCase();
  if (!code || code.length < 9) {
    showAlert('Bitte einen vollständigen Code eingeben (XXXX-XXXX).');
    return;
  }

  verifyBtn.disabled = true;
  verifyBtn.innerHTML = '<span class="spinner"></span> Prüfe…';
  alertBox.innerHTML = '';

  try {
    const res  = await fetch('/api/codes/verify', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ code }),
    });
    const data = await res.json();

    if (!res.ok) {
      showAlert(data.error || 'Ungültiger Code. Bitte erneut versuchen.');
      return;
    }

    if (data.alreadyOrdered) {
      // Redirect to manage-mode so they can view/edit their existing order
      window.location.href =
        `/order.html?personId=${data.person.id}&code=${encodeURIComponent(code)}&mode=manage`;
      return;
    }

    // No existing order – go to fresh order form
    window.location.href = `/order.html?personId=${data.person.id}&code=${encodeURIComponent(code)}`;

  } catch {
    showAlert('Verbindungsfehler. Bitte versuche es erneut.');
  } finally {
    verifyBtn.disabled = false;
    verifyBtn.innerHTML = 'Weiter →';
  }
});
