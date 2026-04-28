/**
 * pdfParser.js – Extrahiert Referenznummern und Beträge aus Bank-PDF-Dateien.
 *
 * Sucht nach Referenzen im Format ABIBALL-XXXXX und verknüpft sie mit
 * dem nächstliegenden EUR-Betrag im Text.
 */
const pdfParse = require('pdf-parse');

/**
 * Extrahiert aus einem PDF-Buffer alle gefundenen Transaktionsdaten.
 *
 * @param {Buffer} buffer  PDF-Datei als Buffer
 * @returns {Promise<Array<{reference: string, amount: number|null, rawSnippet: string}>>}
 */
async function parseBankPdf(buffer) {
  const data = await pdfParse(buffer);
  const text = data.text;
  return extractTransactions(text);
}

/**
 * Sucht im übergebenen Text nach Referenz-Mustern und zugehörigen Beträgen.
 *
 * @param {string} text  Extrahierter PDF-Text
 * @returns {Array<{reference: string, amount: number|null, rawSnippet: string}>}
 */
function extractTransactions(text) {
  // Referenz-Muster: ABIBALL- gefolgt von 4–12 alphanumerischen Zeichen
const refPattern = /ABIBALL-[A-Z0-9]{4}-[A-Z0-9]{4}(?:-\d+)?/gi;

  // Betrag-Muster: z.B. "90,00 EUR", "90.00 EUR", "EUR 90,00", "45,00"
  const amountPattern = /(?:EUR\s*)?(\d{1,6}[.,]\d{2})(?:\s*EUR)?/g;

  const results = [];
  let match;

  while ((match = refPattern.exec(text)) !== null) {
    const reference   = match[0].toUpperCase();
    const matchStart  = match.index;

    // Textfenster: 300 Zeichen vor und nach der Referenz
    const snippetStart = Math.max(0, matchStart - 300);
    const snippetEnd   = Math.min(text.length, matchStart + reference.length + 300);
    const snippet      = text.slice(snippetStart, snippetEnd);

    // Beträge im Snippet suchen, den dem Betrag-Format am nächsten liegenden wählen
    const amounts = [];
    let am;
    amountPattern.lastIndex = 0;
    while ((am = amountPattern.exec(snippet)) !== null) {
      const normalized = am[1].replace('.', '').replace(',', '.');
      const value      = parseFloat(normalized);
      if (!isNaN(value) && value > 0) {
        // Position relativ zur Referenz innerhalb des Snippets
        const refPosInSnippet = matchStart - snippetStart;
        const distance        = Math.abs(am.index - refPosInSnippet);
        amounts.push({ value, distance });
      }
    }

    // Nächstliegenden Betrag wählen
    amounts.sort((a, b) => a.distance - b.distance);
    const amount = amounts.length > 0 ? amounts[0].value : null;

    // Duplikate (gleiche Referenz) zusammenfassen – höchsten Betrag bevorzugen
    const existing = results.find(r => r.reference === reference);
    if (existing) {
      if (amount !== null && (existing.amount === null || amount > existing.amount)) {
        existing.amount = amount;
      }
    } else {
      results.push({ reference, amount, rawSnippet: snippet.slice(0, 200) });
    }
  }

  return results;
}

module.exports = { parseBankPdf, extractTransactions };
