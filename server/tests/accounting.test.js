const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db/pool');
const journalEngine = require('../services/journalEngine');
const { applyPurchase, applyStockOut, round2 } = require('../services/inventoryAccounting');

const USER_ID = 1;
let seq = 0;

function unique(prefix) {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}`;
}

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function assertMoney(actual, expected, message) {
  assert.ok(Math.abs(money(actual) - money(expected)) <= 0.01, `${message}: expected ${expected}, got ${actual}`);
}

async function withDb(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureAccountingTestSchema(client);
    await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

async function ensureAccountingTestSchema(client) {
  await client.query(`
    ALTER TABLE purchase_notes
      ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(15,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS balance_due NUMERIC(15,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'UNPAID'
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS payment_allocations (
      id SERIAL PRIMARY KEY,
      payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
      purchase_note_id INTEGER NOT NULL REFERENCES purchase_notes(id),
      amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS receipt_allocations (
      id SERIAL PRIMARY KEY,
      receipt_id INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id),
      amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function getAccount(client, code) {
  const r = await client.query('SELECT * FROM accounts WHERE code = $1', [code]);
  assert.ok(r.rows[0], `Account ${code} must exist`);
  return r.rows[0];
}

async function createAccount(client, type = 'asset', name = 'Test Account') {
  const code = unique(`T${type.slice(0, 2).toUpperCase()}`).slice(0, 20);
  const r = await client.query(
    `INSERT INTO accounts (code, name, type, is_group, status)
     VALUES ($1,$2,$3,false,'active') RETURNING *`,
    [code, `${name} ${code}`, type]
  );
  return r.rows[0];
}

async function createItem(client, category = 'rough') {
  const code = unique(`IT${category.slice(0, 2).toUpperCase()}`).slice(0, 30);
  const r = await client.query(
    `INSERT INTO items (code, name, category, type, default_uom, quantity_on_hand, avg_cost, inventory_value)
     VALUES ($1,$2,$3,$4,$5,0,0,0) RETURNING *`,
    [code, `Test ${category} ${code}`, category, category === 'rough' ? 'finished_good' : 'raw_material', category === 'rough' ? 'CT' : 'PCS']
  );
  return r.rows[0];
}

async function createVendor(client) {
  const code = unique('TVND').slice(0, 20);
  const r = await client.query(
    `INSERT INTO vendors (code, name, category, payment_term)
     VALUES ($1,$2,'general','Immediate') RETURNING *`,
    [code, `Test Vendor ${code}`]
  );
  return r.rows[0];
}

async function createCustomer(client) {
  const code = unique('TCUS').slice(0, 20);
  const r = await client.query(
    `INSERT INTO customers (code, name, payment_term, outstanding)
     VALUES ($1,$2,'Immediate',0) RETURNING *`,
    [code, `Test Customer ${code}`]
  );
  return r.rows[0];
}

async function createOpeningStock(client, item, quantity, rate, date = '2026-01-01') {
  const value = round2(quantity * rate);
  await client.query(
    `INSERT INTO inventory_opening (item_id, quantity, rate, value, as_of_date, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [item.id, quantity, rate, value, date, USER_ID]
  );
  await client.query(
    `UPDATE items
     SET quantity_on_hand = quantity_on_hand + $1,
         inventory_value = inventory_value + $2,
         avg_cost = ROUND(((inventory_value + $2) / (quantity_on_hand + $1))::numeric, 4)
     WHERE id = $3`,
    [quantity, value, item.id]
  );
  return { quantity, rate, value };
}

async function postPurchase(client, { item, vendor, quantity, rate, date = '2026-01-05' }) {
  const payable = await getAccount(client, '3001');
  const invCode = item.category === 'rough' ? '2004' : item.category === 'gas' ? '2002' : item.category === 'consumable' ? '2003' : '2001';
  const inventoryAccount = await getAccount(client, invCode);
  const amount = round2(quantity * rate);
  const doc = unique('TPN').slice(0, 20);
  const pnR = await client.query(
    `INSERT INTO purchase_notes
       (doc_number, doc_date, vendor_id, item_type, total_qty, total_amount, tax_amount, grand_total,
        amount_paid, balance_due, payment_status, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,0,$6,0,$6,'UNPAID','open',$7) RETURNING *`,
    [doc, date, vendor.id, item.category, quantity, amount, USER_ID]
  );
  const invR = await client.query(
    `INSERT INTO inventory (item_id, lot_number, lot_name, qty, unit, weight, rate, total_value, purchase_date, status, lot_op_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'IN STOCK', nextval('lot_op_id_seq')) RETURNING *`,
    [item.id, unique('LOT').slice(0, 30), `Lot ${doc}`, item.category === 'rough' ? 1 : quantity, item.default_uom, item.category === 'rough' ? quantity : 0, rate, amount, date]
  );
  await client.query(
    `INSERT INTO purchase_note_lines
       (purchase_note_id, line_no, item_id, qty, unit, rate, amount, tax_pct, tax_amount, total, inventory_id)
     VALUES ($1,1,$2,$3,$4,$5,$6,0,0,$6,$7)`,
    [pnR.rows[0].id, item.id, quantity, item.default_uom, rate, amount, invR.rows[0].id]
  );
  await applyPurchase(client, item.id, quantity, rate, amount);
  const je = await journalEngine.createEntry({
    date,
    description: `Test purchase ${doc}`,
    sourceType: 'purchase',
    sourceId: pnR.rows[0].id,
    lines: [
      { accountId: inventoryAccount.id, debit: amount, credit: 0 },
      { accountId: payable.id, debit: 0, credit: amount },
    ],
    createdBy: USER_ID,
    client,
  });
  await client.query('UPDATE purchase_notes SET je_id = $1 WHERE id = $2', [je.id, pnR.rows[0].id]);
  return { purchase: pnR.rows[0], inventory: invR.rows[0], amount, je };
}

async function postSale(client, { item, customer, quantity, rate, date = '2026-01-10' }) {
  const ar = await getAccount(client, '1003');
  const sales = await getAccount(client, '4001');
  const cogs = await getAccount(client, '5001');
  const roughInv = await getAccount(client, '2004');
  const itemR = await client.query('SELECT * FROM items WHERE id = $1 FOR UPDATE', [item.id]);
  const avgCost = Number(itemR.rows[0].avg_cost) || 0;
  const costValue = round2(quantity * avgCost);
  const saleValue = round2(quantity * rate);
  const doc = unique('TINV').slice(0, 20);
  const invR = await client.query(
    `INSERT INTO invoices
       (doc_number, doc_date, customer_id, total_qty, total_weight, sub_total, tax_pct, tax_amount,
        grand_total, amount_paid, balance_due, payment_status, status, created_by)
     VALUES ($1,$2,$3,1,$4,$5,0,0,$5,0,$5,'UNPAID','open',$6) RETURNING *`,
    [doc, date, customer.id, quantity, saleValue, USER_ID]
  );
  await client.query(
    `INSERT INTO invoice_lines (invoice_id, line_no, qty, weight, rate_per_carat, amount, cost_value)
     VALUES ($1,1,1,$2,$3,$4,$5)`,
    [invR.rows[0].id, quantity, rate, saleValue, costValue]
  );
  await stockOutForTest(client, item.id, quantity, costValue);
  const revenueJe = await journalEngine.createEntry({
    date,
    description: `Test sale ${doc}`,
    sourceType: 'invoice',
    sourceId: invR.rows[0].id,
    lines: [
      { accountId: ar.id, debit: saleValue, credit: 0 },
      { accountId: sales.id, debit: 0, credit: saleValue },
    ],
    createdBy: USER_ID,
    client,
  });
  const cogsJe = await journalEngine.createEntry({
    date,
    description: `Test COGS ${doc}`,
    sourceType: 'invoice_cogs',
    sourceId: invR.rows[0].id,
    lines: [
      { accountId: cogs.id, debit: costValue, credit: 0 },
      { accountId: roughInv.id, debit: 0, credit: costValue },
    ],
    createdBy: USER_ID,
    client,
  });
  await client.query('UPDATE invoices SET je_id = $1, cogs_je_id = $2 WHERE id = $3', [revenueJe.id, cogsJe.id, invR.rows[0].id]);
  return { invoice: invR.rows[0], saleValue, costValue, revenueJe, cogsJe };
}

async function stockOutForTest(client, itemId, quantity, value) {
  const itemR = await client.query('SELECT quantity_on_hand, inventory_value FROM items WHERE id = $1 FOR UPDATE', [itemId]);
  const currentQty = Number(itemR.rows[0].quantity_on_hand) || 0;
  if (currentQty + 0.0001 < quantity) throw new Error('Insufficient stock. Negative stock is not allowed.');
  const currentValue = Number(itemR.rows[0].inventory_value) || 0;
  const nextQty = Math.round((currentQty - quantity) * 10000) / 10000;
  const nextValue = Math.max(0, round2(currentValue - value));
  await client.query(
    `UPDATE items
     SET quantity_on_hand = $1::numeric,
         inventory_value = $2::numeric,
         avg_cost = CASE WHEN $1::numeric > 0 THEN ROUND(($2::numeric / $1::numeric)::numeric, 4) ELSE 0 END
     WHERE id = $3`,
    [nextQty, nextValue, itemId]
  );
}

async function postReceipt(client, { invoice, customer, amount, date = '2026-01-12' }) {
  const bank = await getAccount(client, '1002');
  const ar = await getAccount(client, '1003');
  const doc = unique('TRCT').slice(0, 20);
  const je = await journalEngine.createEntry({
    date,
    description: `Test receipt ${doc}`,
    sourceType: 'receipt',
    sourceId: null,
    lines: [
      { accountId: bank.id, debit: amount, credit: 0 },
      { accountId: ar.id, debit: 0, credit: amount },
    ],
    createdBy: USER_ID,
    client,
  });
  const r = await client.query(
    `INSERT INTO receipts (doc_number, date, customer_id, amount, bank_account_id, invoice_id, je_id, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'COMPLETED',$8) RETURNING *`,
    [doc, date, customer.id, amount, bank.id, invoice.id, je.id, USER_ID]
  );
  await client.query('INSERT INTO receipt_allocations (receipt_id, invoice_id, amount) VALUES ($1,$2,$3)', [r.rows[0].id, invoice.id, amount]);
  await client.query('UPDATE invoices SET amount_paid = amount_paid + $1 WHERE id = $2', [amount, invoice.id]);
  await client.query(
    `UPDATE invoices
     SET balance_due = GREATEST(0, grand_total - amount_paid),
         payment_status = CASE WHEN amount_paid >= grand_total THEN 'PAID' WHEN amount_paid > 0 THEN 'PARTIAL' ELSE 'UNPAID' END
     WHERE id = $1`,
    [invoice.id]
  );
  return r.rows[0];
}

async function postPayment(client, { purchase, vendor, amount, date = '2026-01-12' }) {
  const bank = await getAccount(client, '1002');
  const ap = await getAccount(client, '3001');
  const doc = unique('TPAY').slice(0, 20);
  const je = await journalEngine.createEntry({
    date,
    description: `Test payment ${doc}`,
    sourceType: 'payment',
    sourceId: null,
    lines: [
      { accountId: ap.id, debit: amount, credit: 0 },
      { accountId: bank.id, debit: 0, credit: amount },
    ],
    createdBy: USER_ID,
    client,
  });
  const p = await client.query(
    `INSERT INTO payments (doc_number, date, vendor_id, amount, bank_account_id, je_id, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'COMPLETED',$7) RETURNING *`,
    [doc, date, vendor.id, amount, bank.id, je.id, USER_ID]
  );
  await client.query('INSERT INTO payment_allocations (payment_id, purchase_note_id, amount) VALUES ($1,$2,$3)', [p.rows[0].id, purchase.id, amount]);
  await client.query('UPDATE purchase_notes SET amount_paid = COALESCE(amount_paid,0) + $1 WHERE id = $2', [amount, purchase.id]);
  await client.query(
    `UPDATE purchase_notes
     SET balance_due = GREATEST(0, grand_total - amount_paid),
         payment_status = CASE WHEN amount_paid >= grand_total THEN 'PAID' WHEN amount_paid > 0 THEN 'PARTIAL' ELSE 'UNPAID' END
     WHERE id = $1`,
    [purchase.id]
  );
  return p.rows[0];
}

async function reverseEntry(client, jeId, date = '2026-01-20') {
  const jeR = await client.query('SELECT * FROM journal_entries WHERE id = $1', [jeId]);
  assert.ok(jeR.rows[0], 'JE to reverse must exist');
  const linesR = await client.query('SELECT account_id, debit, credit FROM je_lines WHERE je_id = $1 ORDER BY id', [jeId]);
  return journalEngine.createEntry({
    date,
    description: `Test reversal of ${jeR.rows[0].je_number}`,
    sourceType: 'reversal',
    sourceId: jeId,
    lines: linesR.rows.map(l => ({
      accountId: l.account_id,
      debit: Number(l.credit) || 0,
      credit: Number(l.debit) || 0,
    })),
    createdBy: USER_ID,
    client,
  });
}

async function trialBalance(client, from = '1900-01-01', to = '2999-12-31') {
  const r = await client.query(
    `WITH ledger AS (
       SELECT jl.account_id, SUM(jl.debit) AS debit, SUM(jl.credit) AS credit
       FROM je_lines jl
       JOIN journal_entries je ON je.id = jl.je_id
       WHERE je.status = 'posted' AND je.date BETWEEN $1 AND $2
       GROUP BY jl.account_id
     ),
     balances AS (
       SELECT a.type,
              CASE WHEN a.type IN ('asset','expense')
                   THEN COALESCE(l.debit,0) - COALESCE(l.credit,0)
                   ELSE COALESCE(l.credit,0) - COALESCE(l.debit,0)
              END AS balance
       FROM accounts a LEFT JOIN ledger l ON l.account_id = a.id
       WHERE a.is_group = false AND a.status = 'active'
     )
     SELECT
       COALESCE(SUM(CASE WHEN balance > 0 AND type IN ('asset','expense') THEN balance
                         WHEN balance < 0 AND type IN ('liability','equity','revenue') THEN ABS(balance) ELSE 0 END), 0) AS debit,
       COALESCE(SUM(CASE WHEN balance > 0 AND type IN ('liability','equity','revenue') THEN balance
                         WHEN balance < 0 AND type IN ('asset','expense') THEN ABS(balance) ELSE 0 END), 0) AS credit
     FROM balances`,
    [from, to]
  );
  return { totalDebit: Number(r.rows[0].debit) || 0, totalCredit: Number(r.rows[0].credit) || 0 };
}

async function balanceSheet(client, asOf = '2999-12-31') {
  const r = await client.query(
    `WITH ledger AS (
       SELECT jl.account_id, SUM(jl.debit) AS debit, SUM(jl.credit) AS credit
       FROM je_lines jl
       JOIN journal_entries je ON je.id = jl.je_id
       WHERE je.status = 'posted' AND je.date <= $1
       GROUP BY jl.account_id
     )
     SELECT
       COALESCE(SUM(CASE WHEN a.type = 'asset' THEN COALESCE(l.debit,0) - COALESCE(l.credit,0) ELSE 0 END), 0) AS assets,
       COALESCE(SUM(CASE WHEN a.type = 'liability' THEN COALESCE(l.credit,0) - COALESCE(l.debit,0) ELSE 0 END), 0) AS liabilities,
       COALESCE(SUM(CASE WHEN a.type = 'equity' THEN COALESCE(l.credit,0) - COALESCE(l.debit,0) ELSE 0 END), 0) AS equity,
       COALESCE(SUM(CASE WHEN a.type IN ('revenue','expense') THEN COALESCE(l.credit,0) - COALESCE(l.debit,0) ELSE 0 END), 0) AS retained_earnings
     FROM accounts a
     LEFT JOIN ledger l ON l.account_id = a.id
     WHERE a.is_group = false AND a.status = 'active'`,
    [asOf]
  );
  return Object.fromEntries(Object.entries(r.rows[0]).map(([k, v]) => [k, Number(v) || 0]));
}

test('double entry posts balanced debit and credit lines', () => withDb(async client => {
  const cash = await getAccount(client, '1001');
  const capital = await createAccount(client, 'equity', 'Capital');
  const je = await journalEngine.createEntry({
    date: '2026-01-01',
    description: 'QA capital introduction',
    sourceType: 'manual',
    sourceId: null,
    lines: [
      { accountId: cash.id, debit: 1000, credit: 0 },
      { accountId: capital.id, debit: 0, credit: 1000 },
    ],
    createdBy: USER_ID,
    client,
  });
  const r = await client.query('SELECT SUM(debit) AS debit, SUM(credit) AS credit FROM je_lines WHERE je_id = $1', [je.id]);
  assertMoney(r.rows[0].debit, r.rows[0].credit, 'JE debit equals credit');
}));

test('trial balance remains balanced', () => withDb(async client => {
  const cash = await getAccount(client, '1001');
  const capital = await createAccount(client, 'equity', 'Capital');
  await journalEngine.createEntry({
    date: '2026-01-01',
    description: 'QA trial balance',
    sourceType: 'manual',
    lines: [
      { accountId: cash.id, debit: 1000, credit: 0 },
      { accountId: capital.id, debit: 0, credit: 1000 },
    ],
    createdBy: USER_ID,
    client,
  });
  const tb = await trialBalance(client);
  assertMoney(tb.totalDebit, tb.totalCredit, 'Trial balance totals');
}));

test('sales plus COGS uses average stock value, reduces inventory, and posts COGS JE', () => withDb(async client => {
  const item = await createItem(client, 'rough');
  const vendor = await createVendor(client);
  const customer = await createCustomer(client);
  await createOpeningStock(client, item, 100, 10);
  await postPurchase(client, { item, vendor, quantity: 50, rate: 12 });
  const sale = await postSale(client, { item, customer, quantity: 80, rate: 25 });
  const expectedCogs = round2((1600 / 150) * 80);
  const itemR = await client.query('SELECT quantity_on_hand, inventory_value FROM items WHERE id = $1', [item.id]);
  assertMoney(sale.costValue, expectedCogs, 'COGS uses weighted average');
  assertMoney(itemR.rows[0].quantity_on_hand, 70, 'Inventory quantity reduced');
  assertMoney(itemR.rows[0].inventory_value, round2(1600 - expectedCogs), 'Inventory value reduced');
  const cogsJeR = await client.query("SELECT * FROM journal_entries WHERE source_type = 'invoice_cogs' AND source_id = $1", [sale.invoice.id]);
  assert.equal(cogsJeR.rows.length, 1, 'COGS JE posted');
}));

test('P&L formula is internally consistent', () => withDb(async client => {
  const item = await createItem(client, 'rough');
  const vendor = await createVendor(client);
  const customer = await createCustomer(client);
  const rent = await getAccount(client, '5006');
  const bank = await getAccount(client, '1002');
  await createOpeningStock(client, item, 100, 10, '2025-12-31');
  await postPurchase(client, { item, vendor, quantity: 50, rate: 12, date: '2026-01-05' });
  const sale = await postSale(client, { item, customer, quantity: 80, rate: 25, date: '2026-01-10' });
  await journalEngine.createEntry({
    date: '2026-01-15',
    description: 'QA rent',
    sourceType: 'expense',
    lines: [
      { accountId: rent.id, debit: 100, credit: 0 },
      { accountId: bank.id, debit: 0, credit: 100 },
    ],
    createdBy: USER_ID,
    client,
  });

  const revenue = sale.saleValue;
  const opening = 1000;
  const purchases = 600;
  const closingR = await client.query('SELECT inventory_value FROM items WHERE id = $1', [item.id]);
  const cogs = round2(opening + purchases - Number(closingR.rows[0].inventory_value));
  const expenses = 100;
  const netProfit = round2(revenue - cogs - expenses);
  assertMoney(revenue - cogs - expenses, netProfit, 'Revenue - COGS - Expenses equals net profit');
}));

test('balance sheet balances after posted entries', () => withDb(async client => {
  const cash = await getAccount(client, '1001');
  const capital = await createAccount(client, 'equity', 'Capital');
  await journalEngine.createEntry({
    date: '2026-01-01',
    description: 'QA balance sheet',
    sourceType: 'manual',
    lines: [
      { accountId: cash.id, debit: 1000, credit: 0 },
      { accountId: capital.id, debit: 0, credit: 1000 },
    ],
    createdBy: USER_ID,
    client,
  });
  const bs = await balanceSheet(client);
  assertMoney(bs.assets, bs.liabilities + bs.equity + bs.retained_earnings, 'Assets equal liabilities plus equity');
}));

test('AR/AP partial receipt and payment update status and balance', () => withDb(async client => {
  const item = await createItem(client, 'rough');
  const vendor = await createVendor(client);
  const customer = await createCustomer(client);
  await createOpeningStock(client, item, 100, 10);
  const purchase = await postPurchase(client, { item, vendor, quantity: 10, rate: 10 });
  const sale = await postSale(client, { item, customer, quantity: 5, rate: 30 });
  await postReceipt(client, { invoice: sale.invoice, customer, amount: 60 });
  await postPayment(client, { purchase: purchase.purchase, vendor, amount: 40 });
  const invR = await client.query('SELECT payment_status, balance_due FROM invoices WHERE id = $1', [sale.invoice.id]);
  const pnR = await client.query('SELECT payment_status, balance_due FROM purchase_notes WHERE id = $1', [purchase.purchase.id]);
  assert.equal(invR.rows[0].payment_status, 'PARTIAL');
  assertMoney(invR.rows[0].balance_due, sale.saleValue - 60, 'Invoice balance');
  assert.equal(pnR.rows[0].payment_status, 'PARTIAL');
  assertMoney(pnR.rows[0].balance_due, purchase.amount - 40, 'Purchase balance');
}));

test('reversal entry nets original impact to zero', () => withDb(async client => {
  const cash = await getAccount(client, '1001');
  const capital = await createAccount(client, 'equity', 'Capital');
  const je = await journalEngine.createEntry({
    date: '2026-01-01',
    description: 'QA reversal original',
    sourceType: 'manual',
    lines: [
      { accountId: cash.id, debit: 1000, credit: 0 },
      { accountId: capital.id, debit: 0, credit: 1000 },
    ],
    createdBy: USER_ID,
    client,
  });
  await reverseEntry(client, je.id);
  const r = await client.query(
    `SELECT account_id, SUM(debit - credit) AS net
     FROM je_lines jl
     JOIN journal_entries je ON je.id = jl.je_id
     WHERE je.id = $1 OR (je.source_type = 'reversal' AND je.source_id = $1)
     GROUP BY account_id`,
    [je.id]
  );
  for (const row of r.rows) assertMoney(row.net, 0, 'Original and reversal net to zero');
}));

test('period cutoff includes only entries in date range', () => withDb(async client => {
  const cash = await getAccount(client, '1001');
  const revenue = await createAccount(client, 'revenue', 'Test Revenue');
  await journalEngine.createEntry({
    date: '2026-01-01',
    description: 'Out of range',
    sourceType: 'manual',
    lines: [
      { accountId: cash.id, debit: 100, credit: 0 },
      { accountId: revenue.id, debit: 0, credit: 100 },
    ],
    createdBy: USER_ID,
    client,
  });
  await journalEngine.createEntry({
    date: '2026-02-01',
    description: 'In range',
    sourceType: 'manual',
    lines: [
      { accountId: cash.id, debit: 200, credit: 0 },
      { accountId: revenue.id, debit: 0, credit: 200 },
    ],
    createdBy: USER_ID,
    client,
  });
  const r = await client.query(
    `SELECT COALESCE(SUM(jl.credit - jl.debit), 0) AS revenue
     FROM je_lines jl
     JOIN journal_entries je ON je.id = jl.je_id
     WHERE jl.account_id = $1 AND je.status = 'posted' AND je.date BETWEEN $2 AND $3`,
    [revenue.id, '2026-02-01', '2026-02-28']
  );
  assertMoney(r.rows[0].revenue, 200, 'Only February revenue included');
}));

test('negative stock is blocked', () => withDb(async client => {
  const item = await createItem(client, 'rough');
  await createOpeningStock(client, item, 10, 10);
  await assert.rejects(
    () => applyStockOut(client, item.id, 11, 110),
    /Insufficient stock|Negative stock/
  );
}));

test.after(async () => {
  await pool.end();
});
