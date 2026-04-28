/**
 * qrGenerator.js – Erzeugt QR-Code-PNGs
 *
 * generateQrDataUrl()        – Base64 data-URL (EPC / Zahlungs-QR)
 * generateQrBuffer()         – Rohes PNG-Buffer (legacy, ohne token-Tracking)
 * generateQrBufferForTicket()– Rohes PNG-Buffer + schreibt qr_token & qr_issued_at
 *                              in die DB. Altes Token wird damit ungültig.
 */
const QRCode = require('qrcode');
const crypto = require('crypto');

/**
 * @param {string} data  Inhalt des QR-Codes
 * @returns {Promise<string>}  PNG als data-URL (base64)
 */
async function generateQrDataUrl(data) {
  return QRCode.toDataURL(data, { errorCorrectionLevel: 'H', width: 300 });
}

/**
 * @param {string} data
 * @returns {Promise<Buffer>}  Rohes PNG-Buffer (kein token-Tracking)
 */
async function generateQrBuffer(data) {
  return QRCode.toBuffer(data, { errorCorrectionLevel: 'H', width: 300 });
}

/**
 * Erzeugt einen QR-Code für ein Ticket und rotiert dabei den qr_token.
 * Das neue Token wird in order_tickets gespeichert; jeder vorherige
 * QR-Code ist damit automatisch ungültig.
 *
 * @param {object} db        better-sqlite3-Instanz
 * @param {object} ticket    order_tickets-Zeile (muss .id enthalten)
 * @param {object} extraMeta Zusätzliche Felder für den QR-Inhalt (z.B. orderId, personCode)
 * @returns {Promise<Buffer>}
 */
async function generateQrBufferForTicket(db, ticket, extraMeta = {}) {
  const token = crypto.randomUUID();

  const payload = JSON.stringify({
    token,
    ticketId:   ticket.id,
    orderId:    extraMeta.orderId    ?? ticket.order_id,
    personCode: extraMeta.personCode ?? '',
    name:       ticket.ticket_name   ?? '',
  });

  const buf = await QRCode.toBuffer(payload, { errorCorrectionLevel: 'H', width: 300 });

  db.prepare(
    "UPDATE order_tickets SET qr_token = ?, qr_issued_at = datetime('now') WHERE id = ?"
  ).run(token, ticket.id);

  return buf;
}

module.exports = { generateQrDataUrl, generateQrBuffer, generateQrBufferForTicket };
