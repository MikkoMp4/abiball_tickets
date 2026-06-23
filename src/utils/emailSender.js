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
  const subject = 'Abiball 26.06 – Alle Infos auf einen Blick';

  // ── Plaintext-Version ──────────────────────────────────────────────────────
  const textBody =
`Hallo ${personName},

der Freitag rückt näher! Hier kommen alle wichtigen Informationen zum Abiball am 26.06.2026 auf einen Blick.

ABLAUF DES ABENDS
─────────────────
  17:00 Uhr  Einlass
  17:30 Uhr  Beginn des Programms
  19:00 Uhr  Hauptspeise
  22:00 Uhr  Ende des offiziellen Teils

Bitte erscheint möglichst pünktlich, da das Programm um 17:30 Uhr startet.
Die Vorspeise steht bereits auf den Tischen – ihr müsst also nicht lange warten.

AFTERPARTY
──────────
Informationen zu den Afterparty-Tickets für alle Abiturienten werden heute
im Abichat geteilt. Tickets für Freunde und Begleitung sind an der Abendkasse
oder in den kommenden Tagen erhältlich – zunächst jedoch ausschließlich für
die Stufe.

Weitere Formalitäten und Infos folgen in Kürze.

FRAGEN?
───────
Bei Fragen oder Anliegen meldet euch gerne jederzeit:
mikko@vorhanden.de

Wir freuen uns auf einen unvergesslichen Abend mit euch!

Mit besten Grüßen
Das Orga-Team`;

  // ── HTML-Version ───────────────────────────────────────────────────────────
  const htmlBody = `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:#1a1a2e;padding:32px 40px;text-align:center;">
            <p style="margin:0 0 4px;color:#a0a8c8;font-size:13px;letter-spacing:2px;text-transform:uppercase;">26. Juni 2026</p>
            <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:1px;">Abiball 2026</h1>
            <p style="margin:8px 0 0;color:#c8cfe8;font-size:15px;">Alle Infos auf einen Blick</p>
          </td>
        </tr>

        <!-- Greeting -->
        <tr>
          <td style="padding:36px 40px 8px;">
            <p style="margin:0;color:#333333;font-size:16px;line-height:1.6;">
              Hallo <strong>${name}</strong>,
            </p>
            <p style="margin:12px 0 0;color:#555555;font-size:15px;line-height:1.7;">
              der Freitag rückt näher! Hier kommen alle wichtigen Informationen
              zum Abiball auf einen Blick.
            </p>
          </td>
        </tr>

        <!-- Schedule -->
        <tr>
          <td style="padding:28px 40px 8px;">
            <h2 style="margin:0 0 16px;color:#1a1a2e;font-size:14px;font-weight:700;letter-spacing:2px;text-transform:uppercase;border-bottom:2px solid #e8e8f0;padding-bottom:10px;">
              Ablauf des Abends
            </h2>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:8px 16px 8px 0;color:#1a1a2e;font-weight:700;font-size:15px;white-space:nowrap;vertical-align:top;">17:00 Uhr</td>
                <td style="padding:8px 0;color:#444444;font-size:15px;vertical-align:top;">Einlass</td>
              </tr>
              <tr style="background:#f8f8fc;">
                <td style="padding:8px 16px 8px 0;color:#1a1a2e;font-weight:700;font-size:15px;white-space:nowrap;vertical-align:top;">17:30 Uhr</td>
                <td style="padding:8px 0;color:#444444;font-size:15px;vertical-align:top;">Beginn des Programms</td>
              </tr>
              <tr>
                <td style="padding:8px 16px 8px 0;color:#1a1a2e;font-weight:700;font-size:15px;white-space:nowrap;vertical-align:top;">19:00 Uhr</td>
                <td style="padding:8px 0;color:#444444;font-size:15px;vertical-align:top;">Hauptspeise</td>
              </tr>
              <tr style="background:#f8f8fc;">
                <td style="padding:8px 16px 8px 0;color:#1a1a2e;font-weight:700;font-size:15px;white-space:nowrap;vertical-align:top;">22:00 Uhr</td>
                <td style="padding:8px 0;color:#444444;font-size:15px;vertical-align:top;">Ende des offiziellen Teils & Afterparty</td>
              </tr>
            </table>
            <p style="margin:16px 0 0;color:#666666;font-size:14px;line-height:1.6;font-style:italic;">
              Bitte erscheint möglichst pünktlich, da das Programm um 17:30 Uhr startet.
              Die Vorspeise steht bereits auf den Tischen – ihr müsst also nicht lange warten.
              Es gibt kostenlose Alkoholfreie Getränke, Bier und Wein. Spirituosen sind nicht im Preis enthalten, können aber natürlich erworben werden.
            </p>
          </td>
        </tr>

        <!-- Afterparty -->
        <tr>
          <td style="padding:28px 40px 8px;">
            <h2 style="margin:0 0 16px;color:#1a1a2e;font-size:14px;font-weight:700;letter-spacing:2px;text-transform:uppercase;border-bottom:2px solid #e8e8f0;padding-bottom:10px;">
              Afterparty
            </h2>
            <p style="margin:0;color:#555555;font-size:15px;line-height:1.7;">
              Informationen zu den Afterparty-Tickets für alle Abiturienten werden <strong>heute im Abichat</strong> geteilt.
              Tickets für Freunde und Begleitung sind an der <strong>Abendkasse</strong> oder in den
              kommenden Tagen erhältlich – zunächst jedoch ausschließlich für die Stufe.
            </p>
          </td>
        </tr>

        <!-- Further info -->
        <tr>
          <td style="padding:28px 40px 8px;">
            <h2 style="margin:0 0 16px;color:#1a1a2e;font-size:14px;font-weight:700;letter-spacing:2px;text-transform:uppercase;border-bottom:2px solid #e8e8f0;padding-bottom:10px;">
              Weitere Infos
            </h2>
            <p style="margin:0;color:#555555;font-size:15px;line-height:1.7;">
              Bei Fragen oder Anliegen
              meldet euch jederzeit gerne bei mir:
            </p>
            <p style="margin:12px 0 0;">
              <a href="mailto:mikko@vorhanden.de"
                 style="color:#1a1a2e;font-weight:700;font-size:15px;text-decoration:none;border-bottom:1px solid #1a1a2e;">
                mikko@vorhanden.de
              </a>
            </p>
          </td>
        </tr>

        <!-- Sign-off -->
        <tr>
          <td style="padding:28px 40px 36px;">
            <p style="margin:0;color:#555555;font-size:15px;line-height:1.7;">
              Wir freuen uns auf einen unvergesslichen Abend mit euch!
            </p>
            <p style="margin:16px 0 0;color:#333333;font-size:15px;">
              Mit besten Grüßen<br>
              <strong>Das Orga-Team</strong>
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f0f0f6;padding:20px 40px;text-align:center;">
            <p style="margin:0;color:#999999;font-size:12px;line-height:1.6;">
              Diese E-Mail wurde automatisch versandt. · Bei Fragen: <a href="mailto:mikko@vorhanden.de" style="color:#999999;">mikko@vorhanden.de</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

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