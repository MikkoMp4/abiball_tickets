/**
 * bankParser.js – Liest hochgeladene Kontoauszüge (CSV) und extrahiert Buchungen.
 *
 * Unterstütztes Format: einfaches CSV mit den Feldern
 *   Datum, Empfänger/Auftraggeber, Verwendungszweck, Betrag (EUR)
 *
 * Das genaue Trennzeichen und die Spaltennamen werden beim Einlesen tolerant geparst.
 */

/**
 * Parst einen CSV-String (UTF-8) in eine Liste von Buchungs-Objekten.
 *
 * @param {string} csvText
 * @returns {{ date: string, senderName: string, reference: string, amount: number }[]}
 */
function parseBankCsv(csvText) {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 2) return [];

  // Trennzeichen ermitteln (Semikolon oder Komma)
  const sep = lines[0].includes(';') ? ';' : ',';

  const headers = lines[0].split(sep).map(h => h.replace(/"/g, '').trim().toLowerCase());

  const colIndex = key => headers.findIndex(h => h.includes(key));

  const dateIdx      = Math.max(colIndex('datum'), colIndex('date'), colIndex('buchung'), 0);
  const senderIdx    = Math.max(colIndex('auftraggeber'), colIndex('empfänger'), colIndex('sender'), colIndex('name'), 1);
  const refIdx       = Math.max(colIndex('verwendungszweck'), colIndex('reference'), colIndex('zweck'), 2);
  const amountIdx    = Math.max(colIndex('betrag'), colIndex('amount'), colIndex('umsatz'), 3);

  const entries = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(sep).map(c => c.replace(/"/g, '').trim());
    const amountStr = (cols[amountIdx] || '0').replace(/\./g, '').replace(',', '.');
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) continue;

    entries.push({
      date:       cols[dateIdx]   || '',
      senderName: cols[senderIdx] || '',
      reference:  cols[refIdx]    || '',
      amount,
    });
  }
  return entries;
}

module.exports = { parseBankCsv };
