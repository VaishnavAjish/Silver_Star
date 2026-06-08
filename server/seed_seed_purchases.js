// ============================================================
// Dummy data seeder: Seed purchase transactions (vendor "Sigma")
// ------------------------------------------------------------
// Creates 30–40 seed Purchase Notes, each one line with a random
// qty (30–200), routed through the REAL POST /api/purchase-notes
// endpoint so inventory lots, genealogy lot-codes, and journal
// entries are all created consistently (no raw inserts).
//
// RUN THIS ON AN AUTHORIZED HOST (the app/DB server) where both:
//   * the API is reachable on localhost (PORT, default 5000), and
//   * the Postgres host in .env is reachable (pg_hba.conf entry).
//
//   cd server && node seed_seed_purchases.js
//
// Safe to re-run — each run appends a fresh batch of dummy notes.
// ============================================================

require('dotenv').config();
const http = require('http');
const jwt  = require('jsonwebtoken');
const pool = require('./db/pool');
const securityConfig = require('./config/security');

const API_HOST = process.env.SEED_API_HOST || 'localhost';
const API_PORT = parseInt(process.env.PORT) || 5000;

const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Spread doc dates over the last ~60 days for realism.
function randomRecentDate() {
  const d = new Date();
  d.setDate(d.getDate() - randInt(0, 60));
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function postPurchaseNote(token, body) {
  const payload = JSON.stringify(body);
  const options = {
    hostname: API_HOST,
    port: API_PORT,
    path: '/api/purchase-notes',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token,
      'Content-Length': Buffer.byteLength(payload),
    },
  };
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let parsed; try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  const client = await pool.primaryPool.connect();
  let vendor, item, deptId, locId, userId;
  try {
    const v = await client.query("SELECT id, name FROM vendors WHERE name ILIKE '%sigma%' ORDER BY id LIMIT 1");
    if (!v.rows.length) throw new Error("Vendor 'Sigma' not found — create it first.");
    vendor = v.rows[0];

    const it = await client.query("SELECT id, code, name FROM items WHERE category = 'seed' AND status = 'active' ORDER BY id LIMIT 1");
    if (!it.rows.length) throw new Error("No active seed item found in Item Master.");
    item = it.rows[0];

    const d = await client.query("SELECT id FROM departments ORDER BY id LIMIT 1");
    deptId = d.rows[0] ? d.rows[0].id : null;

    const l = await client.query("SELECT id FROM locations ORDER BY id LIMIT 1");
    locId = l.rows[0] ? l.rows[0].id : null;

    // created_by must reference a real user; prefer an admin, fall back to any.
    const u = await client.query(
      `SELECT id FROM users
        ORDER BY (role IN ('super_admin','admin')) DESC, id
        LIMIT 1`
    );
    if (!u.rows.length) throw new Error('No users found for created_by.');
    userId = u.rows[0].id;
  } finally {
    client.release();
  }

  const token = jwt.sign(
    { id: userId, role: 'super_admin', full_name: 'Seed Script' },
    securityConfig.jwt.accessSecret
  );

  const txnCount = randInt(30, 40);
  console.log(`Vendor: ${vendor.name} (id=${vendor.id})  |  Seed item: ${item.code} ${item.name} (id=${item.id})`);
  console.log(`Creating ${txnCount} seed purchase notes (qty 30–200 each)...\n`);

  let ok = 0, fail = 0, totalQty = 0, totalAmount = 0;
  const created = [];

  for (let i = 1; i <= txnCount; i++) {
    const qty  = randInt(30, 200);
    const rate = randInt(800, 2500);           // ₹ per piece (dummy)
    const docDate = randomRecentDate();
    const body = {
      doc_date: docDate,
      vendor_id: vendor.id,
      item_type: 'seed',
      department_id: deptId,
      payment_term: 'Immediate',
      currency: 'INR',
      reference_no: `SIGMA-DUMMY-${Date.now()}-${i}`,
      remark: 'Dummy seed purchase (Sigma) — test data',
      lines: [{
        item_id: item.id,
        description: 'Diamond seed (dummy)',
        batch_no: `B${randInt(1000, 9999)}`,
        qty,
        unit: 'PCS',
        weight: 0,
        rate,
        tax_pct: 0,
        location_id: locId,
      }],
    };

    try {
      const r = await postPurchaseNote(token, body);
      if (r.status === 201) {
        ok++; totalQty += qty; totalAmount += qty * rate;
        created.push(r.body.doc_number);
        console.log(`  [${i}/${txnCount}] OK  ${r.body.doc_number}  qty=${qty}  rate=${rate}  date=${docDate}`);
      } else {
        fail++;
        console.log(`  [${i}/${txnCount}] FAIL (${r.status}): ${JSON.stringify(r.body)}`);
      }
    } catch (e) {
      fail++;
      console.log(`  [${i}/${txnCount}] ERROR: ${e.message}`);
    }
  }

  console.log(`\nDone. Created ${ok} notes (${fail} failed).`);
  console.log(`Total seed qty: ${totalQty} PCS  |  Total value: ₹${totalAmount.toLocaleString('en-IN')}`);
  if (created.length) console.log(`Doc numbers: ${created.join(', ')}`);

  await pool.shutdown();
}

main().catch(async (e) => {
  console.error('Seeder failed:', e.message);
  try { await pool.shutdown(); } catch {}
  process.exit(1);
});
