/**
 * qrGenerator.js – Erzeugt QR-Code-PNGs
 *
 * generateQrDataUrl()        – Base64 data-URL (EPC / Zahlungs-QR)
 * generateQrBuffer()         – Rohes PNG-Buffer (legacy, ohne token-Tracking)
 * generateQrBufferForTicket()– Rohes PNG-Buffer.
 *                              Reuses existing qr_token unless forceRotate=true.
 *                              forceRotate:true only when name/email actually changed.
 */
const QRCode = require('qrcode');
const crypto = require('crypto');

async function generateQrDataUrl(data) {
  return QRCode.toDataURL(data, { errorCorrectionLevel: 'H', width: 300 });
}

async function generateQrBuffer(data) {
  return QRCode.toBuffer(data, { errorCorrectionLevel: 'H', width: 300 });
}

/**
 * Erzeugt einen QR-Code für ein Ticket.
 *
 * Wenn das Ticket bereits einen qr_token hat und forceRotate nicht gesetzt ist,
 * wird der bestehende Token wiederverwendet – kein DB-Update, kein neues Token.
 * So bleibt der QR-Code auf der Website identisch mit dem per E-Mail verschickten.
 *
 * forceRotate:true nur bei echten Änderungen (Name/E-Mail-Update in PATCH-Route).
 *
 * @param {object} db          better-sqlite3-Instanz
 * @param {object} ticket      order_tickets-Zeile (muss .id und .qr_token enthalten)
 * @param {object} extraMeta   Zusätzliche Felder für den QR-Inhalt
 * @param {boolean} forceRotate  Neues Token erzwingen (default: false)
 * @returns {Promise<Buffer>}
 */
async function generateQrBufferForTicket(db, ticket, extraMeta = {}, forceRotate = false) {
  let token = ticket.qr_token;

  if (!token || forceRotate) {
    token = crypto.randomUUID();
    db.prepare(
      "UPDATE order_tickets SET qr_token = ?, qr_issued_at = datetime('now') WHERE id = ?"
    ).run(token, ticket.id);
  }

  const payload = JSON.stringify({
    token,
    ticketId:   ticket.id,
    orderId:    extraMeta.orderId    ?? ticket.order_id,
    personCode: extraMeta.personCode ?? '',
    name:       ticket.ticket_name   ?? '',
  });

  return QRCode.toBuffer(payload, { errorCorrectionLevel: 'H', width: 300 });
}

module.exports = { generateQrDataUrl, generateQrBuffer, generateQrBufferForTicket };
