/**
 * routes/admin.js – Admin-Endpunkte
 *
 * POST /api/admin/generate-codes   – Codes für mehrere Personen generieren
 * GET  /api/admin/persons          – Alle Personen auflisten
 * GET  /api/admin/export/csv       – Codes als CSV exportieren
 * GET  /api/admin/export/excel     – Codes als Excel exportieren
 */
const express  = require('express');
const router   = express.Router();
const ExcelJS  = require('exceljs');
const { createObjectCsvStringifier } = require('csv-writer');
const { getDb } = require('../database');
const { generateUniqueCodes } = require('../utils/codeGenerator');

// ── POST /api/admin/generate-codes ──────────────────────────────────────────
router.post('/generate-codes', (req, res) => {
  const { persons } = req.body;
  // persons: [{ name, email, numTickets }]
  if (!Array.isArray(persons) || persons.length === 0) {
    return res.status(400).json({ error: 'persons-Array erforderlich' });
  }

  const db = getDb();
  const existing = new Set(db.prepare('SELECT code FROM persons').all().map(r => r.code));
  const codes    = generateUniqueCodes(persons.length, existing);

  const insert = db.prepare(
    'INSERT INTO persons (name, email, code, num_tickets) VALUES (@name, @email, @code, @numTickets)'
  );

  const insertMany = db.transaction(list => {
    return list.map((p, i) =>
      insert.run({ name: p.name, email: p.email || '', code: codes[i], numTickets: p.numTickets || 1 })
    );
  });

  try {
    insertMany(persons);
    const created = db.prepare('SELECT * FROM persons ORDER BY id DESC LIMIT ?')
      .all(persons.length)
      .reverse();
    res.json({ created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/persons ───────────────────────────────────────────────────
router.get('/persons', (req, res) => {
  const db = getDb();
  const persons = db.prepare('SELECT * FROM persons ORDER BY id').all();
  res.json({ persons });
});

// ── DELETE /api/admin/persons/:id ───────────────────────────────────────────
router.delete('/persons/:id', (req, res) => {
  const db = getDb();
  const info = db.prepare('DELETE FROM persons WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json({ ok: true });
});

// ── GET /api/admin/export/csv ────────────────────────────────────────────────
router.get('/export/csv', (req, res) => {
  const db      = getDb();
  const persons = db.prepare('SELECT name, email, code, num_tickets FROM persons ORDER BY id').all();

  const csvStringifier = createObjectCsvStringifier({
    header: [
      { id: 'name',        title: 'Name' },
      { id: 'email',       title: 'E-Mail' },
      { id: 'code',        title: 'Zugangscode' },
      { id: 'num_tickets', title: 'Anzahl Tickets' },
    ],
  });

  const csv = csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(persons);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="zugangscodes.csv"');
  res.send('\uFEFF' + csv); // BOM für Excel-Kompatibilität
});

// ── GET /api/admin/export/excel ──────────────────────────────────────────────
router.get('/export/excel', async (req, res) => {
  const db      = getDb();
  const persons = db.prepare('SELECT name, email, code, num_tickets FROM persons ORDER BY id').all();

  const workbook  = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Zugangscodes');

  worksheet.columns = [
    { header: 'Name',           key: 'name',        width: 30 },
    { header: 'E-Mail',         key: 'email',        width: 35 },
    { header: 'Zugangscode',    key: 'code',         width: 15 },
    { header: 'Anzahl Tickets', key: 'num_tickets',  width: 15 },
  ];

  // Kopfzeile formatieren
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: 'pattern', pattern: 'solid',
    fgColor: { argb: 'FFCCE5FF' },
  };

  persons.forEach(p => worksheet.addRow(p));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="zugangscodes.xlsx"');

  await workbook.xlsx.write(res);
  res.end();
});

module.exports = router;
