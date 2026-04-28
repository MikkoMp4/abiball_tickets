/**
 * routes/admin.js – Admin-Endpunkte
 *
 * POST   /api/admin/generate-codes                      – Codes für mehrere Personen generieren
 * GET    /api/admin/persons                             – Alle Personen auflisten
 * PATCH  /api/admin/persons/:id                         – Person aktualisieren
 * DELETE /api/admin/persons/:id                         – Person löschen (CASCADE)
 * GET    /api/admin/orders                              – Alle Bestellungen auflisten
 * GET    /api/admin/stats                               – Dashboard-Statistiken
 * POST   /api/admin/upload-pdf                          – Bank-PDF hochladen, abgleichen, E-Mails senden
 * GET    /api/admin/export/csv                          – Codes als CSV exportieren
 * GET    /api/admin/export/excel                        – Codes als Excel exportieren
 * POST   /api/admin/orders/:id/mark-paid                – Bestellung als bezahlt markieren + E-Mail senden
 * DELETE /api/admin/orders/:orderId/ticket/:ticketId    – Einzelnes Ticket aus Bestellung löschen (Admin only)
 *
 * ── DANGER ZONE ─────────────────────────────────────────────────────────────
 * DELETE /api/admin/danger/person/:id       – Einzelne Person + alle Daten löschen
 * DELETE /api/admin/danger/order/:id        – Einzelne Bestellung löschen
 * DELETE /api/admin/danger/payment/:id      – Einzelne Zahlung löschen
 * DELETE /api/admin/danger/all              – ALLE Daten löschen (nuclear)
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
const { generateQrBuffer }           = require('../utils/qrGenerator');
const { sendTicketEmail }            = require('../utils/emailSender');

// Multer: PDF-Upload im Arbeitsspeicher
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ext === '.pdf');
  },
});

// Pre-hash DANGER_PASSWORD at startup
const RAW_DANGER_PW = process.env.DANGER_PASSWORD || '';
let hashedDangerPw  = null;
(async () => {
  if (RAW_DANGER_PW) hashedDangerPw = await bcrypt.hash(RAW_DANGER_PW, 10);
})();

/** Middleware: verifies the danger-zone password in req.body.dangerPassword */
async function requireDangerPw(req, res, next) {
  if (!RAW_DANGER_PW) {
    return res.status(500).json({ error: 'DANGER_PASSWORD ist nicht gesetzt.' });
  }
  const submitted = req.body?.dangerPassword;
  if (!submitted) {
    return res.status(401).json({ error: 'Danger-Passwort fehlt.' });
  }
  const ok = await bcrypt.compare(submitted, hashedDangerPw);
  if (!ok) {
    await new Promise(r => setTimeout(r, 500));
    return res.status(403).json({ error: 'Falsches Danger-Passwort.' });
  }
  next();
}

/**
 * Shared helper: send one QR-email per ticket for a given order.
 * Reads recipient address from ticket_email column.
 * Returns array of addresses that were emailed.
 */
async function sendTicketsForOrder(db, person, order) {
  const orderTickets = db.prepare('SELECT * FROM order_tickets WHERE order_id = ?').all(order.id);
  const sentTo = [];

  for (const ticket of orderTickets) {
    const toEmail = (ticket.ticket_email || '').trim();
    if (!toEmail) continue;

    const qrBuffer = await generateQrBuffer(JSON.stringify({
      ticketId:   ticket.id,
      orderId:    order.id,
      personCode: person.code,
      name:       ticket.ticket_name,
    }));

    await sendTicketEmail({
      to:         toEmail,
      personName: ticket.ticket_name || person.name,
      qrBuffers:  [qrBuffer],
    });

    sentTo.push(toEmail);
  }

  return sentTo;
}

// ── POST /api/admin/generate-codes ────────────────────────────────────────────
router.post('/generate-codes', (req, res) => {
  const { persons } = req.body;
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
      insert.run({
        name:       p.name || 'Unbekannt',
        email:      '',
        code:       codes[i],
        numTickets: p.numTickets || 1,
      })
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

// ── GET /api/admin/persons ───────────────────────────────────────────────
router.get('/persons', (req, res) => {
  const db = getDb();
  const persons = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM orders o WHERE o.person_id = p.id AND o.submitted = 1) AS has_order,
      (SELECT COUNT(*) FROM orders o WHERE o.person_id = p.id AND o.paid = 1)      AS is_paid
    FROM persons p
    ORDER BY p.id
  `).all();
  res.json({ persons });
});

// ── PATCH /api/admin/persons/:id ────────────────────────────────────────────
router.patch('/persons/:id', (req, res) => {
  const db = getDb();
  const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(req.params.id);
  if (!person) return res.status(404).json({ error: 'Person nicht gefunden' });

  const { name, numTickets } = req.body;
  db.prepare(
    'UPDATE persons SET name = ?, num_tickets = ? WHERE id = ?'
  ).run(
    name       ?? person.name,
    numTickets ?? person.num_tickets,
    req.params.id
  );
  res.json({ ok: true });
});

// ── DELETE /api/admin/persons/:id ────────────────────────────────────────────
router.delete('/persons/:id', (req, res) => {
  const db = getDb();
  const info = db.prepare('DELETE FROM persons WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json({ ok: true });
});

// ── GET /api/admin/orders ───────────────────────────────────────────────
router.get('/orders', (req, res) => {
  const db = getDb();
  const orders = db.prepare(`
    SELECT o.*, p.name AS person_name, p.email AS person_email, p.code AS person_code,
      (SELECT COUNT(*) FROM order_tickets ot WHERE ot.order_id = o.id) AS ticket_count
    FROM orders o
    JOIN persons p ON p.id = o.person_id
    WHERE o.submitted = 1
    ORDER BY o.id DESC
  `).all();

  const getTickets = db.prepare('SELECT * FROM order_tickets WHERE order_id = ?');
  const result = orders.map(o => ({
    ...o,
    tickets: getTickets.all(o.id),
  }));

  res.json({ orders: result });
});

// ── GET /api/admin/stats ─────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  const db = getDb();
  const totalPersons    = db.prepare('SELECT COUNT(*) AS n FROM persons').get().n;
  const totalOrders     = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE submitted = 1').get().n;
  const paidOrders      = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE paid = 1').get().n;
  const unpaidOrders    = totalOrders - paidOrders;
  const totalTickets    = db.prepare('SELECT COUNT(*) AS n FROM order_tickets').get().n;
  const totalPayments   = db.prepare('SELECT COUNT(*) AS n FROM payments').get().n;
  const matchedPayments = db.prepare('SELECT COUNT(*) AS n FROM payments WHERE matched = 1').get().n;
  const totalRevenue    = db.prepare('SELECT COALESCE(SUM(total_eur),0) AS s FROM orders WHERE paid = 1').get().s;
  const pendingRevenue  = db.prepare('SELECT COALESCE(SUM(total_eur),0) AS s FROM orders WHERE submitted = 1 AND paid = 0').get().s;

  res.json({
    totalPersons, totalOrders, paidOrders, unpaidOrders,
    totalTickets, totalPayments, matchedPayments,
    totalRevenue, pendingRevenue,
  });
});

// ── POST /api/admin/upload-pdf ───────────────────────────────────────────────
router.post('/upload-pdf', pdfUpload.array('pdfs', 20), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'Keine PDF-Datei hochgeladen' });
  }

  const db          = getDb();
  const settings    = getSettings();
  const allResults  = [];
  const matchedForEmail = [];

  for (const file of req.files) {
    let transactions;
    try {
      transactions = await parseBankPdf(file.buffer);
    } catch (err) {
      allResults.push({ file: file.originalname, error: `PDF konnte nicht gelesen werden: ${err.message}` });
      continue;
    }

    for (const tx of transactions) {
      const ref        = tx.reference.toUpperCase();
      const codeMatch  = ref.match(/ABIBALL-([A-Z0-9]{4,12})/);
      const code       = codeMatch ? codeMatch[1] : null;
      const person     = code ? db.prepare('SELECT * FROM persons WHERE code = ?').get(code) : null;
      const order      = person
        ? db.prepare('SELECT * FROM orders WHERE person_id = ? AND submitted = 1 ORDER BY id DESC LIMIT 1').get(person.id)
        : null;
      const expectedAmount = order ? order.total_eur : null;
      const amountMatches  = tx.amount !== null && expectedAmount !== null &&
                             Math.abs(tx.amount - expectedAmount) < 0.02;
      let markedPaid = false;

      if (person && order && amountMatches && !order.paid) {
        db.prepare("UPDATE orders SET paid = 1, paid_at = datetime('now') WHERE id = ?").run(order.id);
        const existingPayment = db.prepare('SELECT * FROM payments WHERE reference = ?').get(ref);
        if (!existingPayment) {
          db.prepare(`
            INSERT INTO payments (person_id, amount_eur, reference, sender_name, booking_date, matched)
            VALUES (?, ?, ?, ?, datetime('now'), 1)
          `).run(person.id, tx.amount, ref, person.name);
        } else if (!existingPayment.matched) {
          db.prepare('UPDATE payments SET matched = 1, person_id = ? WHERE id = ?').run(person.id, existingPayment.id);
        }
        markedPaid = true;
        matchedForEmail.push({ person, order });
      }

      allResults.push({
        file: file.originalname, reference: ref, amount: tx.amount,
        personName: person ? person.name : null, expectedAmount,
        amountMatches, alreadyPaid: order ? !!order.paid : false, markedPaid,
      });
    }

    if (transactions.length === 0) {
      allResults.push({ file: file.originalname, error: 'Keine Abiball-Referenzen im PDF gefunden' });
    }
  }

  const emailResults = [];
  for (const { person, order } of matchedForEmail) {
    try {
      const sentTo = await sendTicketsForOrder(db, person, order);
      emailResults.push({ person: person.name, sentTo, ok: true });
    } catch (err) {
      emailResults.push({ person: person.name, error: err.message, ok: false });
    }
  }

  res.json({
    processed: allResults.length,
    newlyPaid: matchedForEmail.length,
    emailsSent: emailResults,
    results: allResults,
  });
});

// ── POST /api/admin/orders/:id/mark-paid ─────────────────────────────────────────
router.post('/orders/:id/mark-paid', async (req, res) => {
  const db    = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Bestellung nicht gefunden' });

  if (order.paid) return res.json({ ok: true, alreadyPaid: true });

  db.prepare("UPDATE orders SET paid = 1, paid_at = datetime('now') WHERE id = ?").run(req.params.id);

  const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  const person       = db.prepare('SELECT * FROM persons WHERE id = ?').get(updatedOrder.person_id);

  let emailResult = null;
  if (person) {
    try {
      const sentTo = await sendTicketsForOrder(db, person, updatedOrder);
      emailResult = { ok: true, sentTo };
    } catch (err) {
      emailResult = { ok: false, error: err.message };
    }
  }

  res.json({ ok: true, email: emailResult });
});

// ── DELETE /api/admin/orders/:orderId/ticket/:ticketId ───────────────────────
// Admin-only: remove a single ticket from any order.
// Does NOT require dangerPassword – regular admin session is sufficient.
// Blocked for paid orders to prevent QR-token inconsistency.
router.delete('/orders/:orderId/ticket/:ticketId', (req, res) => {
  const db = getDb();
  const s  = getSettings();

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Bestellung nicht gefunden' });

  // Admins can delete tickets from paid orders only after explicit acknowledgement;
  // return a dedicated error code so the admin UI can show a confirmation dialog.
  if (order.paid === 1) {
    return res.status(409).json({
      error: 'paid_order',
      message: 'Diese Bestellung wurde bereits bezahlt. Bitte den Sachverhalt prüfen und ggf. die Gefahr-Zone verwenden.',
    });
  }

  const remaining = db.prepare(
    'SELECT COUNT(*) as cnt FROM order_tickets WHERE order_id = ?'
  ).get(req.params.orderId);
  if (remaining.cnt <= 1) {
    return res.status(409).json({
      error: 'last_ticket',
      message: 'Mindestens ein Ticket muss verbleiben. Um die gesamte Bestellung zu löschen, die Gefahr-Zone verwenden.',
    });
  }

  const ticket = db.prepare(
    'SELECT * FROM order_tickets WHERE id = ? AND order_id = ?'
  ).get(req.params.ticketId, req.params.orderId);
  if (!ticket) return res.status(404).json({ error: 'Ticket nicht gefunden' });

  const ticketPrice = parseFloat(s.ticket_price || '45');

  db.transaction(() => {
    db.prepare('DELETE FROM order_tickets WHERE id = ?').run(req.params.ticketId);
    db.prepare('UPDATE orders SET total_eur = total_eur - ? WHERE id = ?').run(ticketPrice, req.params.orderId);
  })();

  const newTotal = db.prepare('SELECT total_eur FROM orders WHERE id = ?').get(req.params.orderId).total_eur;
  res.json({ ok: true, newTotalEur: newTotal, deletedTicket: ticket });
});

// ── GET /api/admin/export/csv ────────────────────────────────────────────────
router.get('/export/csv', (req, res) => {
  const db      = getDb();
  const persons = db.prepare('SELECT name, code, num_tickets FROM persons ORDER BY id').all();

  const csvStringifier = createObjectCsvStringifier({
    header: [
      { id: 'name',        title: 'Name' },
      { id: 'code',        title: 'Zugangscode' },
      { id: 'num_tickets', title: 'Anzahl Tickets' },
    ],
  });

  const csv = csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(persons);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="zugangscodes.csv"');
  res.send('\uFEFF' + csv);
});

// ── GET /api/admin/export/excel ────────────────────────────────────────────────
router.get('/export/excel', async (req, res) => {
  const db      = getDb();
  const persons = db.prepare('SELECT name, code, num_tickets FROM persons ORDER BY id').all();

  const workbook  = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Zugangscodes');
  worksheet.columns = [
    { header: 'Name',           key: 'name',        width: 30 },
    { header: 'Zugangscode',    key: 'code',         width: 15 },
    { header: 'Anzahl Tickets', key: 'num_tickets',  width: 15 },
  ];
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE0CC' } };
  persons.forEach(p => worksheet.addRow(p));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="zugangscodes.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

// ═══════════════════════════════════════════════════════════════════════════════
// ⚠️  DANGER ZONE  – alle Endpunkte erfordern dangerPassword im Request-Body
// ═══════════════════════════════════════════════════════════════════════════════

router.delete('/danger/person/:id', requireDangerPw, (req, res) => {
  const db     = getDb();
  const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(req.params.id);
  if (!person) return res.status(404).json({ error: 'Person nicht gefunden' });
  db.prepare('DELETE FROM persons WHERE id = ?').run(req.params.id);
  res.json({ ok: true, deleted: 'person', id: req.params.id, name: person.name });
});

router.delete('/danger/order/:id', requireDangerPw, (req, res) => {
  const db    = getDb();
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
    if (payment.matched && payment.person_id) {
      db.prepare(
        'UPDATE orders SET paid = 0, paid_at = NULL WHERE person_id = ? AND paid = 1'
      ).run(payment.person_id);
    }
    db.prepare('DELETE FROM payments WHERE id = ?').run(req.params.id);
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
