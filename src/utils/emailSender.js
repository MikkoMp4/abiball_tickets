/**
 * emailSender.js – Versendet Ticket-QR-Codes per E-Mail (nodemailer)
 *
 * SMTP-Konfiguration über Umgebungsvariablen:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM
 */
const nodemailer = require('nodemailer');

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.example.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
  });
}

/**
 * Sendet Ticket-QR-Codes als E-Mail-Anhänge.
 *
 * @param {object} opts
 * @param {string}   opts.to          Empfänger-E-Mail
 * @param {string}   opts.personName  Vollständiger Name
 * @param {Buffer[]} opts.qrBuffers   QR-Code-Bilder als Buffer-Array
 * @returns {Promise<object>}  nodemailer-Ergebnis
 */
async function sendTicketEmail({ to, personName, qrBuffers }) {
  const transport = createTransport();

  // HTML-Sonderzeichen escapen um XSS zu verhindern
  const safeName = String(personName)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const attachments = qrBuffers.map((buf, idx) => ({
    filename: `ticket_${idx + 1}.png`,
    content: buf,
    contentType: 'image/png',
  }));

  const info = await transport.sendMail({
    from: process.env.MAIL_FROM || '"no-reply Abiball Tickets" <tickets@example.com>',
    to,
    subject: 'Deine Abiball-Tickets',
    text: `Hallo ${personName},\n\nvielen Dank für deine Bestellung! Im Anhang findest du deine Ticket-QR-Codes.\nBitte zeige diese am Einlass vor.\n Zur Erinnerung: Der Abiball ist am 26.06.2026!\nVorrraussichtlicher Start ist um !7:00 Uhr, dazu kriegst du aber nocheinmal eine E-mail!\n\nDas Orga Team`,
    html: `<p>Hallo <strong>${safeName}</strong>,</p>
           <p>vielen Dank für deine Bestellung! Im Anhang findest du deine Ticket-QR-Codes.<br>
           Bitte zeige diese am Einlass vor.</p>
           <p>Zur Erinnerung: der Abiball ist am <strong>26.06.2026.</strong><br>Vorraussichtlicher Start ist um 17:00 Uhr, dazu kriegst du aber nocheinmal eine Mail.</p>
           <p><em>Das Orga-Team</em></p>`,
    attachments,
  });

  return info;
}

module.exports = { sendTicketEmail };
