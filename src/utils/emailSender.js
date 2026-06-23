/**
 * emailSender.js – Versendet Ticket-QR-Codes per E-Mail (nodemailer)
 *
 * SMTP-Konfiguration über Umgebungsvariablen:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM
 */
const nodemailer = require('nodemailer');

function createTransport() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'smtp.example.com',
    port:   parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
  });
}

function safeName(name) {
  return String(name)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Sendet ein einzelnes Ticket-QR-Code als E-Mail.
 *
 * @param {object} opts
 * @param {string}        opts.to           Empfänger-E-Mail
 * @param {string}        opts.personName   Vollständiger Name
 * @param {Buffer|null}   opts.qrBuffer     QR-Code-Bild als Buffer (null = kein Anhang)
 * @param {boolean}       [opts.updated]    true = geändertes Ticket (Betreff anpassen)
 */
async function sendSingleTicketEmail({ to, personName, qrBuffer, updated = false }) {
  const transport = createTransport();
  const name = safeName(personName);
  const hasQr = !!qrBuffer;
  const subject = updated ? 'Dein aktualisiertes Abiball-Ticket' : 'Dein Abiball-Ticket';

  const textBody = hasQr
    ? `Hallo ${personName},\n\n${
        updated
          ? 'deine Kontaktdaten haben sich geändert. Im Anhang findest du dein aktualisiertes Ticket-QR-Code.'
          : 'vielen Dank für deine Bestellung! Im Anhang findest du deinen Ticket-QR-Code.'
      }\nBitte zeige diesen am Einlass vor.\nZur Erinnerung: Der Abiball ist am 26.06.2026!\nVorraussichtlicher Start ist um 17:00 Uhr.\n\nDas Orga-Team`
    : `Hallo ${personName},\n\nZur Erinnerung: Der Abiball ist am 26.06.2026!\nVorraussichtlicher Start ist um 17:00 Uhr.\n\nBei Fragen melde dich beim Orga-Team.\n\nDas Orga-Team`;

  const htmlBody = hasQr
    ? `<p>Hallo <strong>${name}</strong>,</p>
       <p>${
         updated
           ? 'deine Kontaktdaten haben sich geändert. Im Anhang findest du dein <strong>aktualisiertes</strong> Ticket-QR-Code.'
           : 'vielen Dank für deine Bestellung! Im Anhang findest du deinen Ticket-QR-Code.'
       }<br>Bitte zeige diesen am Einlass vor.</p>
       <p>Zur Erinnerung: der Abiball ist am <strong>26.06.2026.</strong><br>Vorraussichtlicher Start ist um 17:00 Uhr, dazu kriegst du aber nocheinmal eine Mail.</p>
       <p><em>Das Orga-Team</em></p>`
    : `<p>Hallo <strong>${name}</strong>,</p>
       <p>Zur Erinnerung: der Abiball ist am <strong>26.06.2026.</strong><br>
       Vorraussichtlicher Start ist um 17:00 Uhr.</p>
       <p>Bei Fragen melde dich beim Orga-Team.</p>
       <p><em>Das Orga-Team</em></p>`;

  await transport.sendMail({
    from:        process.env.MAIL_FROM || '"no-reply Abiball Tickets" <tickets@example.com>',
    to,
    subject,
    text:        textBody,
    html:        htmlBody,
    attachments: hasQr ? [{ filename: 'ticket.png', content: qrBuffer, contentType: 'image/png' }] : [],
  });
}

/**
 * Sendet alle Tickets einer Bestellung (für admin mark-paid / PDF-Upload).
 *
 * @param {object} opts
 * @param {string}   opts.to          Empfänger-E-Mail
 * @param {string}   opts.personName  Vollständiger Name
 * @param {Buffer[]} opts.qrBuffers   QR-Code-Bilder als Buffer-Array
 */
async function sendTicketEmail({ to, personName, qrBuffers }) {
  const transport = createTransport();
  const name = safeName(personName);

  const attachments = qrBuffers.map((buf, idx) => ({
    filename: `ticket_${idx + 1}.png`,
    content:  buf,
    contentType: 'image/png',
  }));

  await transport.sendMail({
    from: process.env.MAIL_FROM || '"no-reply Abiball Tickets" <tickets@example.com>',
    to,
    subject: 'Deine Abiball-Tickets',
    text: `Hallo ${personName},\n\nvielen Dank für deine Bestellung! Im Anhang findest du deine Ticket-QR-Codes.\nBitte zeige diese am Einlass vor.\nZur Erinnerung: Der Abiball ist am 26.06.2026!\nVorraussichtlicher Start ist um 17:00 Uhr, dazu kriegst du aber nocheinmal eine E-mail!\n\nDas Orga Team`,
    html: `<p>Hallo <strong>${name}</strong>,</p>
           <p>vielen Dank für deine Bestellung! Im Anhang findest du deine Ticket-QR-Codes.<br>
           Bitte zeige diese am Einlass vor.</p>
           <p>Zur Erinnerung: der Abiball ist am <strong>26.06.2026.</strong><br>Vorraussichtlicher Start ist um 17:00 Uhr, dazu kriegst du aber nocheinmal eine Mail.</p>
           <p><em>Das Orga-Team</em></p>`,
    attachments,
  });
}

/**
 * Sendet eine Follow-Up-E-Mail an alle bezahlten Ticket-Inhaber.
 * Wird ausschließlich vom Bulk-Mailer (/api/admin/send-all-tickets) verwendet.
 * Texte hier eintragen ↓
 *
 * @param {object} opts
 * @param {string}        opts.to           Empfänger-E-Mail
 * @param {string}        opts.personName   Vollständiger Name
 * @param {Buffer|null}   opts.qrBuffer     QR-Code-Bild als Buffer (null = kein Anhang)
 */
async function sendFollowUpEmail({ to, personName, qrBuffer }) {
  const transport = createTransport();
  const name = safeName(personName);
  const hasQr = !!qrBuffer;

  // ── Betreff ────────────────────────────────────────────────────────────────
  const subject = ''; // TODO: Betreff hier eintragen

  // ── Plaintext-Version ──────────────────────────────────────────────────────
  const textBody = `Hallo ${personName},\n\n` +
    // TODO: Text hier eintragen
    `\n\nDas Orga-Team`;

  // ── HTML-Version ───────────────────────────────────────────────────────────
  const htmlBody =
    `<p>Hallo <strong>${name}</strong>,</p>` +
    // TODO: HTML hier eintragen
    `<p><em>Das Orga-Team</em></p>`;

  await transport.sendMail({
    from:        process.env.MAIL_FROM || '"no-reply Abiball Tickets" <tickets@example.com>',
    to,
    subject,
    text:        textBody,
    html:        htmlBody,
    attachments: hasQr ? [{ filename: 'ticket.png', content: qrBuffer, contentType: 'image/png' }] : [],
  });
}

module.exports = { sendTicketEmail, sendSingleTicketEmail, sendFollowUpEmail };
