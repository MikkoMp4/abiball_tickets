/**
 * epcGenerator.js – Erstellt EPC-QR-Code-Payloads (SEPA Girocode)
 *
 * Standard: European Payments Council – Quick Response Code
 * Version 002 / Encoding UTF-8
 */

/**
 * Erzeugt den Rohdaten-String für einen EPC-QR-Code (Girocode).
 *
 * @param {object} opts
 * @param {string} opts.name         Empfängername (max 70 Zeichen)
 * @param {string} opts.iban         IBAN des Empfängers
 * @param {string} opts.bic          BIC/SWIFT des Empfängers (optional ab Version 002)
 * @param {number} opts.amount       Betrag in Euro
 * @param {string} opts.reference    Verwendungszweck / Referenz (max 35 Zeichen)
 * @param {string} [opts.information] Anzeigenachricht (max 70 Zeichen)
 * @returns {string}
 */
function buildEpcPayload({ name, iban, bic = '', amount, reference, information = '' }) {
  const amountStr = `EUR${amount.toFixed(2)}`;

  // EPC QR Code Datenformat (Zeilen-basiert)
  const lines = [
    'BCD',            // Service Tag
    '002',            // Version
    '1',              // Encoding: UTF-8
    'SCT',            // SEPA Credit Transfer
    bic,              // BIC (leer = optional bei Version 002)
    name.slice(0, 70),
    iban.replace(/\s/g, ''),
    amountStr,
    '',               // Purpose (leer)
    reference.slice(0, 35),
    information.slice(0, 70),
  ];

  return lines.join('\n');
}

module.exports = { buildEpcPayload };
