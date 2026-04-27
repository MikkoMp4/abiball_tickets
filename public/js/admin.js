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
  document.getElementById(id).innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
}
function clearAlert(id) {
  document.getElementById(id).innerHTML = '';
}
function fmt(eur) {
  return eur != null
    ? Number(eur).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
    : '–';
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
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted)">Keine Personen vorhanden.</td></tr>';
    return;
  }
  tbody.innerHTML = persons.map(p => `
    <tr>
      <td><strong>${esc(p.name)}</strong></td>
      <td>${esc(p.email || '–')}</td>
      <td><code>${esc(p.code)}</code></td>
      <td>${p.num_tickets}</td>
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
  if (res.ok) loadPersons();
  else showAlert('personsAlert', 'Fehler beim Löschen.');
};

// ── Codes generieren ──────────────────────────────────────────────────────────
document.getElementById('generateBtn').addEventListener('click', async () => {
  clearAlert('genAlert');
  const raw  = document.getElementById('personsBulk').value.trim();
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

  const btn = document.getElementById('generateBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Generiere…';

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
  } catch {
    showAlert('genAlert', 'Verbindungsfehler.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Codes generieren';
  }
});

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
               onclick="sendTickets(${p.id})">✉ Tickets senden</button>`
          : ''}
      </td>
    </tr>
  `).join('');
}

window.sendTickets = async function(paymentId) {
  const btn = event.target;
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

// ── Kontoauszug hochladen ─────────────────────────────────────────────────────
document.getElementById('uploadBtn').addEventListener('click', async () => {
  const fileInput = document.getElementById('statementFile');
  if (!fileInput.files.length) {
    showAlert('uploadAlert', 'Bitte eine CSV-Datei auswählen.', 'warning');
    return;
  }

  const btn = document.getElementById('uploadBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Verarbeite…';
  clearAlert('uploadAlert');

  const form = new FormData();
  form.append('statement', fileInput.files[0]);

  try {
    const res  = await fetch('/api/payments/upload', { method: 'POST', body: form });
    const data = await res.json();

    if (!res.ok) { showAlert('uploadAlert', data.error || 'Fehler.'); return; }

    const matched = data.results.filter(r => r.matched).length;
    showAlert('uploadAlert',
      `✅ ${data.processed} Buchungen eingelesen, ${matched} Zahlungen zugeordnet.`,
      'success'
    );
    fileInput.value = '';
    loadPayments();
  } catch {
    showAlert('uploadAlert', 'Verbindungsfehler.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Hochladen & prüfen';
  }
});

// ── Escaping ──────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Start ─────────────────────────────────────────────────────────────────────
loadPersons();
loadPayments();
