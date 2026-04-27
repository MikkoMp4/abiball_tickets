/**
 * codeGenerator.js – Generiert zufällige Zugangscodes
 */
const { randomInt } = require('crypto');

/**
 * Erzeugt einen zufälligen alphanumerischen Code der Länge `length`.
 * Standardlänge: 8 Zeichen (z. B. "AB3X-9K2M").
 * Verwendet crypto.randomInt() für unvoreingenommene Gleichverteilung.
 */
function generateCode(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars[randomInt(chars.length)];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Erzeugt `count` einmalige Codes.
 */
function generateUniqueCodes(count, existingCodes = new Set()) {
  const codes = [];
  while (codes.length < count) {
    const code = generateCode();
    if (!existingCodes.has(code) && !codes.includes(code)) {
      codes.push(code);
    }
  }
  return codes;
}

module.exports = { generateCode, generateUniqueCodes };
