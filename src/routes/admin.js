/**
 * routes/admin.js
 *
 * orders.paid:  0=unbezahlt  1=vollstaendig bezahlt  2=teilweise bezahlt
 */
const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const path     = require('path');
const ExcelJS  = require('exceljs');
const bcrypt   = require('bcrypt');
const { createObjectCsvStringifier } = require('csv-writer');
const { getDb, getSettings }         = require('../database');
const { generateUniqueCodes }        = require('../utils/codeGenerator');
const { parseBankPdf }               = require('../utils/pdfParser');
const { generateQrBufferForTicket }  = require('../utils/qrGenerator');
const { sendTicketEmail }            = require('../utils/emailSender');
const { recalcPaymentStatus }        = require('./payments');

const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, path.extname(file.originalname).toLowerCase() === '.pdf'),
});

const statementUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ['.csv', '.xlsx', '.xls'].includes(ext));
  },
});

const RAW_DANGER_PW = process.env.DANGER_PASSWORD || '';
let hashedDangerPw  = null;
(async () => { if (RAW_DANGER_PW) hashedDangerPw = await bcrypt.hash(RAW_DANGER_PW, 10); })();

async function requireDangerPw(req, res, next) {
  if (!RAW_DANGER_PW) return res.status(500).json({ error: 'DANGER_PASSWORD nicht gesetzt.' });
  const ok = await bcrypt.compare(req.body?.dangerPassword || '', hashedDangerPw);
  if (!ok) { await new Promise(r => setTimeout(r, 500)); return res.status(403).json({ error: 'Falsches Danger-Passwort.' }); }
  next();
}

async function sendTicketsForOrder(db, person, order) {
  const orderTickets = db.prepare('SELECT * FROM order_tickets WHERE order_id = ?').all(order.id);
  const sentTo = [];
  for (const ticket of orderTickets) {
    const toEmail = (ticket.ticket_email || '').trim();
    if (!toEmail) continue;
    const qrBuffer = await generateQrBufferForTicket(db, ticket, { orderId: order.id, personCode: person.code });
    await sendTicketEmail({ to: toEmail, personName: ticket.ticket_name || person.name, qrBuffers: [qrBuffer] });
    sentTo.push(toEmail);
  }
  return sentTo;
}

function findCsvHeaderLine(lines) {
  const HEADER_KEYWORDS = ['buchungsdatum', 'buchungstag', 'verwendungszweck', 'betrag', 'date', 'amount'];
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (HEADER_KEYWORDS.some(k => lower.includes(k))) return i;
  }
  return 0;
}

function normHeader(h) {
  return h
    .replace(/^"|"$/g, '')
    .trim()
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeColIdx(header) {
  return (candidates) => {
    for (const c of candidates) {
      const i = header.findIndex(h => h.includes(c));
      if (i !== -1) return i;
    }
    return -1;
  };
}

/**
 * Extrahiert den Abiball-Code aus einem Verwendungszweck-String.
 */
function extractAbiballCode(ref, allPersonCodes) {
  const m = ref.match(/ABIBALL[-\s]?([A-Z0-9]{4}[-\s]?[A-Z0-9]{4})/i);
  if (m) return m[1].replace(/\s/g, '-').toUpperCase();
  if (allPersonCodes) {
    for (const code of allPersonCodes) {
      if (ref.toUpperCase().includes(code.toUpperCase())) return code;
    }
  }
  return null;
}

router.post('/generate-codes', (req, res) => {
  const { persons } = req.body;
  if (!Array.isArray(persons) || !persons.length) return res.status(400).json({ error: 'persons-Array erforderlich' });
  const db = getDb();
  const existing = new Set(db.prepare('SELECT code FROM persons').all().map(r => r.code));
  const codes    = generateUniqueCodes(persons.length, existing);
  const insert   = db.prepare('INSERT INTO persons (name, email, code, num_tickets) VALUES (@name, @email, @code, @numTickets)');
  try {
    db.transaction(list => list.map((p, i) => insert.run({ name: p.name || 'Unbekannt', email: '', code: codes[i], numTickets: p.numTickets || 1 })))(persons);
    res.json({ created: db.prepare('SELECT * FROM persons ORDER BY id DESC LIMIT ?').all(persons.length).reverse() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/persons', (req, res) => {
  const db = getDb();
  res.json({ persons: db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM orders o WHERE o.person_id = p.id AND o.submitted = 1) AS has_order,
      (SELECT COUNT(*) FROM orders o WHERE o.person_id = p.id AND o.paid = 1)      AS is_paid
    FROM persons p ORDER BY p.id
  `).all() });
});

router.patch('/persons/:id', (req, res) => {
  const db = getDb();
  const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(req.params.id);
  if (!person) return res.status(404).json({ error: 'Person nicht gefunden' });
  const { name, numTickets } = req.body;
  db.prepare('UPDATE persons SET name = ?, num_tickets = ? WHERE id = ?').run(name ?? person.name, numTickets ?? person.num_tickets, req.params.id);
  res.json({ ok: true });
});

router.delete('/persons/:id', (req, res) => {
  const db   = getDb();
  const info = db.prepare('DELETE FROM persons WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json({ ok: true });
});

router.get('/orders', (req, res) => {
  const db     = getDb();
  const orders = db.prepare(`
    SELECT o.*, p.name AS person_name, p.email AS person_email, p.code AS person_code,
      (SELECT COUNT(*) FROM order_tickets ot WHERE ot.order_id = o.id) AS ticket_count
    FROM orders o JOIN persons p ON p.id = o.person_id
    WHERE o.submitted = 1 ORDER BY o.id DESC
  `).all();
  const getTickets = db.prepare('SELECT * FROM order_tickets WHERE order_id = ?');
  res.json({ orders: orders.map(o => ({ ...o, tickets: getTickets.all(o.id) })) });
});

router.get('/orders/debug', (req, res) => {
  const db     = getDb();
  const orders = db.prepare(`
    SELECT o.*, p.name AS person_name, p.code AS person_code
    FROM orders o JOIN persons p ON p.id = o.person_id
    ORDER BY o.id DESC
  `).all();
  const payments = db.prepare('SELECT * FROM payments ORDER BY id DESC').all();
  res.json({ orders, payments });
});

router.get('/stats', (req, res) => {
  const db = getDb();
  res.json({
    totalPersons:    db.prepare('SELECT COUNT(*) AS n FROM persons').get().n,
    totalOrders:     db.prepare('SELECT COUNT(*) AS n FROM orders WHERE submitted = 1').get().n,
    paidOrders:      db.prepare('SELECT COUNT(*) AS n FROM orders WHERE paid = 1').get().n,
    partialOrders:   db.prepare('SELECT COUNT(*) AS n FROM orders WHERE paid = 2').get().n,
    unpaidOrders:    db.prepare('SELECT COUNT(*) AS n FROM orders WHERE submitted = 1 AND paid = 0').get().n,
    totalTickets:    db.prepare('SELECT COUNT(*) AS n FROM order_tickets').get().n,
    totalPayments:   db.prepare('SELECT COUNT(*) AS n FROM payments').get().n,
    matchedPayments: db.prepare('SELECT COUNT(*) AS n FROM payments WHERE matched = 1').get().n,
    totalRevenue:    db.prepare('SELECT COALESCE(SUM(total_eur),0) AS s FROM orders WHERE paid = 1').get().s,
    partialRevenue:  db.prepare('SELECT COALESCE(SUM(paid_amount),0) AS s FROM orders WHERE paid = 2').get().s,
    pendingRevenue:  db.prepare('SELECT COALESCE(SUM(total_eur),0) AS s FROM orders WHERE submitted = 1 AND paid = 0').get().s,
  });
});

router.post('/upload-pdf', pdfUpload.array('pdfs', 20), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'Keine PDF-Datei hochgeladen' });
  const db = getDb();
  const allResults = [];
  const affectedPersonIds = new Set();
  const allPersonCodes = db.prepare('SELECT code FROM persons').all().map(r => r.code);

  for (const file of req.files) {
    let transactions;
    try { transactions = await parseBankPdf(file.buffer); }
    catch (err) { allResults.push({ file: file.originalname, error: `PDF Fehler: ${err.message}` }); continue; }

    for (const tx of transactions) {
      const ref    = tx.reference.toUpperCase();
      const code   = extractAbiballCode(ref, allPersonCodes);
      const person = code ? db.prepare('SELECT * FROM persons WHERE code = ?').get(code) : null;
      const order  = person ? db.prepare('SELECT * FROM orders WHERE person_id = ? AND submitted = 1 ORDER BY id DESC LIMIT 1').get(person.id) : null;

      if (person && order && tx.amount !== null) {
        const existing = db.prepare('SELECT id FROM payments WHERE reference = ?').get(ref);
        if (!existing) {
          db.prepare("INSERT INTO payments (person_id, amount_eur, reference, sender_name, booking_date, matched) VALUES (?, ?, ?, ?, datetime('now'), 1)")
            .run(person.id, tx.amount, ref, person.name);
          affectedPersonIds.add(person.id);
        }
        affectedPersonIds.add(person.id);
      }
      allResults.push({ file: file.originalname, reference: ref, amount: tx.amount, personName: person?.name || null, matched: !!person });
    }
    if (!transactions.length) allResults.push({ file: file.originalname, error: 'Keine Abiball-Referenzen gefunden' });
  }

  const newlyFullyPaid = [];
  for (const personId of affectedPersonIds) {
    const { nowFullyPaid, order } = recalcPaymentStatus(db, personId);
    if (nowFullyPaid && order) newlyFullyPaid.push({ person: db.prepare('SELECT * FROM persons WHERE id = ?').get(personId), order });
  }

  const emailResults = [];
  for (const { person, order } of newlyFullyPaid) {
    try { emailResults.push({ person: person.name, sentTo: await sendTicketsForOrder(db, person, order), ok: true }); }
    catch (err) { emailResults.push({ person: person.name, error: err.message, ok: false }); }
  }

  res.json({ processed: allResults.length, newlyPaid: newlyFullyPaid.length, emailsSent: emailResults, results: allResults });
});

router.post('/upload-statement', statementUpload.single('statement'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen' });

  const db  = getDb();
  const ext = path.extname(req.file.originalname).toLowerCase();
  const rows = [];
  const allPersonCodes = db.prepare('SELECT code FROM persons').all().map(r => r.code);

  try {
    if (ext === '.csv') {
      const text  = req.file.buffer.toString('utf-8').replace(/^\uFEFF/, '');
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) return res.status(400).json({ error: 'CSV ist leer oder hat keine Datenzeilen' });

      const sep        = lines.find(l => l.includes(';')) ? ';' : ',';
      const headerLine = findCsvHeaderLine(lines);
      const header     = lines[headerLine].split(sep).map(normHeader);
      const colIdx     = makeColIdx(header);

      const dateCol = colIdx(['buchungsdatum', 'buchungstag', 'valuta', 'date', 'datum']);
      const nameCol = colIdx(['zahlungspflichtige', 'auftraggeber', 'beguenstigter', 'absender', 'sender', 'name']);
      const refCol  = colIdx(['verwendungszweck', 'reference', 'referenz', 'betreff', 'description', 'buchungstext']);
      const amtCol  = colIdx(['betrag', 'amount', 'umsatz', 'wert']);

      if (refCol === -1 || amtCol === -1) {
        return res.status(400).json({
          error: `CSV-Format nicht erkannt. Erkannte Spalten: ${header.join(', ')}. Ben\u00f6tigt: Verwendungszweck + Betrag`,
        });
      }

      for (let i = headerLine + 1; i < lines.length; i++) {
        const cols = lines[i].split(sep);
        const clean = (idx) => (idx !== -1 && cols[idx] !== undefined) ? cols[idx].replace(/^"|"$/g, '').trim() : '';
        const rawAmt = clean(amtCol).replace(/\u20ac/g, '').replace(/\./g, '').replace(',', '.').replace(/\s+/g, '');
        const amount = parseFloat(rawAmt);
        if (isNaN(amount) || amount <= 0) continue;

        rows.push({
          booking_date: clean(dateCol) || new Date().toISOString().slice(0, 10),
          sender_name:  clean(nameCol) || 'Unbekannt',
          reference:    clean(refCol),
          amount_eur:   amount,
        });
      }
    } else {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(req.file.buffer);
      const ws = workbook.worksheets[0];
      if (!ws) return res.status(400).json({ error: 'Excel-Datei enth\u00e4lt kein Worksheet' });

      let headerRowNum = 1;
      ws.eachRow((row, rowNum) => {
        if (headerRowNum !== 1) return;
        const lower = row.values.map(v => String(v || '').toLowerCase()).join(' ');
        if (['buchungsdatum', 'buchungstag', 'verwendungszweck', 'betrag', 'date'].some(k => lower.includes(k))) {
          headerRowNum = rowNum;
        }
      });

      const header = [];
      ws.getRow(headerRowNum).eachCell((cell, colNum) => { header[colNum] = normHeader(String(cell.value || '')); });
      const colIdx = makeColIdx(header);

      const dateCol = colIdx(['buchungsdatum', 'buchungstag', 'valuta', 'date', 'datum']);
      const nameCol = colIdx(['zahlungspflichtige', 'auftraggeber', 'beguenstigter', 'absender', 'sender', 'name']);
      const refCol  = colIdx(['verwendungszweck', 'reference', 'referenz', 'betreff', 'description', 'buchungstext']);
      const amtCol  = colIdx(['betrag', 'amount', 'umsatz', 'wert']);

      if (refCol === -1 || amtCol === -1) {
        return res.status(400).json({ error: 'Excel-Format nicht erkannt.' });
      }

      ws.eachRow((row, rowNum) => {
        if (rowNum <= headerRowNum) return;
        const get = (idx) => idx !== -1 ? String(row.getCell(idx).value || '').trim() : '';
        const rawAmt = get(amtCol).replace(/\u20ac/g, '').replace(/\./g, '').replace(',', '.').replace(/\s+/g, '');
        const amount = parseFloat(rawAmt);
        if (isNaN(amount) || amount <= 0) return;
        rows.push({
          booking_date: get(dateCol) || new Date().toISOString().slice(0, 10),
          sender_name:  get(nameCol) || 'Unbekannt',
          reference:    get(refCol),
          amount_eur:   amount,
        });
      });
    }
  } catch (err) {
    return res.status(400).json({ error: `Datei konnte nicht gelesen werden: ${err.message}` });
  }

  if (!rows.length) return res.status(400).json({ error: 'Keine verarbeitbaren Zeilen in der Datei gefunden' });

  const allResults = [];
  const affectedPersonIds = new Set();

  const insertPayment = db.prepare(
    'INSERT OR IGNORE INTO payments (person_id, amount_eur, reference, sender_name, booking_date, matched) VALUES (?, ?, ?, ?, ?, 1)'
  );

  for (const row of rows) {
    const ref    = (row.reference || '').toUpperCase();
    const code   = extractAbiballCode(ref, allPersonCodes);
    const person = code ? db.prepare('SELECT * FROM persons WHERE code = ?').get(code) : null;
    const order  = person ? db.prepare('SELECT * FROM orders WHERE person_id = ? AND submitted = 1 ORDER BY id DESC LIMIT 1').get(person.id) : null;

    if (person && order) {
      insertPayment.run(person.id, row.amount_eur, ref, row.sender_name || person.name, row.booking_date);
      affectedPersonIds.add(person.id);

      if (order.split_payment) {
        const splitMatch = ref.match(/-(\d+)$/);
        if (splitMatch) {
          const ticketNum = parseInt(splitMatch[1], 10);
          const ticket = db.prepare(
            'SELECT * FROM order_tickets WHERE order_id = ? AND split_ref LIKE ?'
          ).get(order.id, `%-${ticketNum}`);
          if (ticket && !ticket.split_paid_at) {
            db.prepare(
              "UPDATE order_tickets SET split_paid_at = datetime('now'), split_amount = ?, ticket_paid = 1 WHERE id = ?"
            ).run(row.amount_eur, ticket.id);
          }
        } else {
          const s = getSettings();
          const ticketPrice = parseFloat(s.ticket_price || '45');
          let remaining = row.amount_eur;
          const unpaidTickets = db.prepare(
            'SELECT * FROM order_tickets WHERE order_id = ? AND split_paid_at IS NULL ORDER BY id ASC'
          ).all(order.id);
          for (const ticket of unpaidTickets) {
            if (remaining >= ticketPrice - 0.01) {
              db.prepare(
                "UPDATE order_tickets SET split_paid_at = datetime('now'), split_amount = ?, ticket_paid = 1 WHERE id = ?"
              ).run(ticketPrice, ticket.id);
              remaining -= ticketPrice;
            }
          }
        }
      }
    }

    allResults.push({
      reference:     ref,
      amount:        row.amount_eur,
      sender:        row.sender_name,
      personName:    person?.name || null,
      orderId:       order?.id || null,
      orderTotalEur: order?.total_eur || null,
      matched:       !!person,
    });
  }

  const newlyFullyPaid = [];
  for (const personId of affectedPersonIds) {
    const { nowFullyPaid, order } = recalcPaymentStatus(db, personId);
    if (nowFullyPaid && order) newlyFullyPaid.push({ person: db.prepare('SELECT * FROM persons WHERE id = ?').get(personId), order });
  }

  const emailResults = [];
  for (const { person, order } of newlyFullyPaid) {
    try { emailResults.push({ person: person.name, sentTo: await sendTicketsForOrder(db, person, order), ok: true }); }
    catch (err) { emailResults.push({ person: person.name, error: err.message, ok: false }); }
  }

  res.json({
    processed:  allResults.length,
    matched:    allResults.filter(r => r.matched).length,
    newlyPaid:  newlyFullyPaid.length,
    emailsSent: emailResults,
    results:    allResults,
  });
});

router.post('/orders/:id/mark-paid', async (req, res) => {
  const db    = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Bestellung nicht gefunden' });
  if (order.paid === 1) return res.json({ ok: true, alreadyPaid: true });
  db.prepare("UPDATE orders SET paid = 1, paid_amount = total_eur, paid_at = COALESCE(paid_at, datetime('now')) WHERE id = ?").run(req.params.id);
  db.prepare('UPDATE order_tickets SET ticket_paid = 1 WHERE order_id = ?').run(req.params.id);
  const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  const person       = db.prepare('SELECT * FROM persons WHERE id = ?').get(updatedOrder.person_id);
  let emailResult = null;
  if (person) {
    try { emailResult = { ok: true, sentTo: await sendTicketsForOrder(db, person, updatedOrder) }; }
    catch (err) { emailResult = { ok: false, error: err.message }; }
  }
  res.json({ ok: true, email: emailResult });
});

router.post('/orders/:orderId/ticket/:ticketId/mark-paid', async (req, res) => {
  const db     = getDb();
  const s      = getSettings();
  const order  = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Bestellung nicht gefunden' });

  const ticket = db.prepare('SELECT * FROM order_tickets WHERE id = ? AND order_id = ?')
    .get(req.params.ticketId, req.params.orderId);
  if (!ticket) return res.status(404).json({ error: 'Ticket nicht gefunden' });
  if (ticket.ticket_paid) return res.json({ ok: true, alreadyPaid: true });

  const ticketPrice = parseFloat(s.ticket_price || '45');

  db.transaction(() => {
    db.prepare("UPDATE order_tickets SET ticket_paid = 1 WHERE id = ?").run(req.params.ticketId);
    db.prepare("UPDATE orders SET paid_amount = COALESCE(paid_amount, 0) + ?, paid_at = COALESCE(paid_at, datetime('now')) WHERE id = ?")
      .run(ticketPrice, req.params.orderId);
    const total   = db.prepare('SELECT COUNT(*) AS n FROM order_tickets WHERE order_id = ?').get(req.params.orderId).n;
    const paidCnt = db.prepare('SELECT COUNT(*) AS n FROM order_tickets WHERE order_id = ? AND ticket_paid = 1').get(req.params.orderId).n;
    const newPaidStatus = paidCnt >= total ? 1 : 2;
    db.prepare('UPDATE orders SET paid = ? WHERE id = ?').run(newPaidStatus, req.params.orderId);
  })();

  const updatedOrder  = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId);
  const person        = db.prepare('SELECT * FROM persons WHERE id = ?').get(order.person_id);
  let emailResult     = null;

  if (person) {
    try {
      const { generateQrBufferForTicket } = require('../utils/qrGenerator');
      const { sendSingleTicketEmail }     = require('../utils/emailSender');
      const updatedTicket = db.prepare('SELECT * FROM order_tickets WHERE id = ?').get(req.params.ticketId);
      const qrBuffer = await generateQrBufferForTicket(db, updatedTicket, { orderId: order.id, personCode: person.code });
      await sendSingleTicketEmail({ to: updatedTicket.ticket_email, personName: updatedTicket.ticket_name, qrBuffer, updated: false });
      emailResult = { ok: true, sentTo: updatedTicket.ticket_email };
    } catch (err) {
      emailResult = { ok: false, error: err.message };
    }
  }

  res.json({ ok: true, newPaidStatus: updatedOrder.paid, email: emailResult });
});

router.delete('/orders/:orderId/ticket/:ticketId', (req, res) => {
  const db = getDb();
  const s  = getSettings();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Bestellung nicht gefunden' });
  if (order.paid === 1) return res.status(409).json({ error: 'paid_order', message: 'Bestellung bereits bezahlt.' });
  const remaining = db.prepare('SELECT COUNT(*) as cnt FROM order_tickets WHERE order_id = ?').get(req.params.orderId);
  if (remaining.cnt <= 1) return res.status(409).json({ error: 'last_ticket', message: 'Mindestens ein Ticket muss verbleiben.' });
  const ticket = db.prepare('SELECT * FROM order_tickets WHERE id = ? AND order_id = ?').get(req.params.ticketId, req.params.orderId);
  if (!ticket) return res.status(404).json({ error: 'Ticket nicht gefunden' });
  const ticketPrice = parseFloat(s.ticket_price || '45');
  db.transaction(() => {
    db.prepare('DELETE FROM order_tickets WHERE id = ?').run(req.params.ticketId);
    db.prepare('UPDATE orders SET total_eur = total_eur - ? WHERE id = ?').run(ticketPrice, req.params.orderId);
  })();
  res.json({ ok: true, newTotalEur: db.prepare('SELECT total_eur FROM orders WHERE id = ?').get(req.params.orderId).total_eur, deletedTicket: ticket });
});

router.get('/export/csv', (req, res) => {
  const db      = getDb();
  const persons = db.prepare('SELECT name, code, num_tickets FROM persons ORDER BY id').all();
  const csvStringifier = createObjectCsvStringifier({
    header: [{ id: 'name', title: 'Name' }, { id: 'code', title: 'Zugangscode' }, { id: 'num_tickets', title: 'Anzahl Tickets' }],
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="zugangscodes.csv"');
  res.send('\uFEFF' + csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(persons));
});

router.get('/export/excel', async (req, res) => {
  const db      = getDb();
  const persons = db.prepare('SELECT name, code, num_tickets FROM persons ORDER BY id').all();
  const workbook  = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Zugangscodes');
  worksheet.columns = [{ header: 'Name', key: 'name', width: 30 }, { header: 'Zugangscode', key: 'code', width: 15 }, { header: 'Anzahl Tickets', key: 'num_tickets', width: 15 }];
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE0CC' } };
  persons.forEach(p => worksheet.addRow(p));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="zugangscodes.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

router.delete('/danger/person/:id', requireDangerPw, (req, res) => {
  const db = getDb();
  const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(req.params.id);
  if (!person) return res.status(404).json({ error: 'Person nicht gefunden' });
  db.prepare('DELETE FROM persons WHERE id = ?').run(req.params.id);
  res.json({ ok: true, deleted: 'person', id: req.params.id, name: person.name });
});

router.delete('/danger/order/:id', requireDangerPw, (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Bestellung nicht gefunden' });
  db.prepare('DELETE FROM orders WHERE id = ?').run(req.params.id);
  res.json({ ok: true, deleted: 'order', id: req.params.id });
});

router.delete('/danger/payment/:id', requireDangerPw, (req, res) => {
  const db      = getDb();
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Zahlung nicht gefunden' });
  db.transaction(() => {
    db.prepare('DELETE FROM payments WHERE id = ?').run(req.params.id);
    if (payment.person_id) recalcPaymentStatus(db, payment.person_id);
  })();
  res.json({ ok: true, deleted: 'payment', id: req.params.id });
});

router.delete('/danger/all', requireDangerPw, (req, res) => {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM payments').run();
    db.prepare('DELETE FROM order_tickets').run();
    db.prepare('DELETE FROM orders').run();
    db.prepare('DELETE FROM persons').run();
  })();
  res.json({ ok: true, deleted: 'all' });
});

module.exports = router;
