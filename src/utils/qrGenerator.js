/**
 * qrGenerator.js – Erzeugt QR-Code-PNGs als Base64-String
 */
const QRCode = require('qrcode');

/**
 * @param {string} data  Inhalt des QR-Codes
 * @returns {Promise<string>}  PNG als data-URL (base64)
 */
async function generateQrDataUrl(data) {
  return QRCode.toDataURL(data, { errorCorrectionLevel: 'H', width: 300 });
}

/**
 * @param {string} data
 * @returns {Promise<Buffer>}  Rohes PNG-Buffer
 */
async function generateQrBuffer(data) {
  return QRCode.toBuffer(data, { errorCorrectionLevel: 'H', width: 300 });
}

module.exports = { generateQrDataUrl, generateQrBuffer };
