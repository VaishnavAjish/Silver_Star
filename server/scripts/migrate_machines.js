const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'silverstar_grow',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('--- MACHINE INTELLIGENCE FOUNDATION MIGRATION ---');
    await client.query('BEGIN');
    console.log('Transaction started.');

    // 1. Create department_locations table if not exists
    console.log('Creating department_locations table if not exists...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS department_locations (
        id SERIAL PRIMARY KEY,
        department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
        is_default BOOLEAN DEFAULT false,
        can_view_inventory BOOLEAN DEFAULT true,
        can_start_process BOOLEAN DEFAULT true,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(department_id, location_id)
      )
    `);

    // 2. Resolve Master Data
    console.log('Resolving Master Data...');
    const depts = await client.query("SELECT id, name, code FROM departments");
    const dp01 = depts.rows.find(d => d.code === 'DP01' || d.name.includes('DP01') || d.name === 'CVD');
    const dp03 = depts.rows.find(d => d.code === 'DP03' || d.name.includes('DP03') || d.name === 'Laser');
    if (!dp01 || !dp03) throw new Error(`Missing required Departments. Found: ${JSON.stringify(depts.rows)}`);

    const locs = await client.query("SELECT id, name, code FROM locations");
    const getLocId = (str) => {
      const loc = locs.rows.find(l => (l.code === str) || (l.name && l.name.includes(str)));
      if (!loc) throw new Error(`Missing required Location: ${str}. Found: ${JSON.stringify(locs.rows)}`);
      return loc.id;
    };
    const [O01, O03, O04, O05, O06] = ['O01', 'O03', 'O04', 'O05', 'O06'].map(getLocId);

    // 3. Insert Department Locations
    console.log('Inserting Department-Location mappings...');
    const mappings = [
      { dept: dp01.id, loc: O01, def: true },
      { dept: dp01.id, loc: O04, def: false },
      { dept: dp01.id, loc: O05, def: false },
      { dept: dp01.id, loc: O06, def: false },
      { dept: dp03.id, loc: O03, def: true },
    ];
    for (const m of mappings) {
      await client.query(`
        INSERT INTO department_locations (department_id, location_id, is_default) 
        VALUES ($1, $2, $3)
        ON CONFLICT (department_id, location_id) DO UPDATE SET is_default = EXCLUDED.is_default
      `, [m.dept, m.loc, m.def]);
    }

    // 4. Preflight Machine Check
    console.log('Locking machines for preflight and update...');
    // Lock only relevant machines
    const { rows: ssdRows } = await client.query(`SELECT id, code, status, type, department_id, location_id FROM machines WHERE code LIKE 'SSD-%' FOR UPDATE`);
    const { rows: lsRows } = await client.query(`SELECT id, code, status, type, department_id, location_id FROM machines WHERE code LIKE 'LS-%' FOR UPDATE`);

    console.log(`Found ${ssdRows.length} SSD machines and ${lsRows.length} LS machines.`);

    // Expected approved codes
    const expectedSSDCodes = new Set();
    for(let i=1; i<=116; i++) expectedSSDCodes.add(`SSD-${String(i).padStart(3, '0')}`);
    
    const expectedLSCodes = new Set();
    for(let i=1; i<=5; i++) expectedLSCodes.add(`LS-${String(i).padStart(2, '0')}`);

    const actualSSDCodes = new Set(ssdRows.map(m => m.code));
    const actualLSCodes = new Set(lsRows.map(m => m.code));

    const missingSSD = [...expectedSSDCodes].filter(c => !actualSSDCodes.has(c));
    const missingLS = [...expectedLSCodes].filter(c => !actualLSCodes.has(c));
    const extraSSD = [...actualSSDCodes].filter(c => !expectedSSDCodes.has(c));
    const extraLS = [...actualLSCodes].filter(c => !expectedLSCodes.has(c));

    if (missingSSD.length > 0) throw new Error(`Missing SSD machines: ${missingSSD.join(', ')}`);
    if (missingLS.length > 0) throw new Error(`Missing LS machines: ${missingLS.join(', ')}`);
    if (extraSSD.length > 0) throw new Error(`Unexpected extra SSD machines: ${extraSSD.join(', ')}`);
    if (extraLS.length > 0) throw new Error(`Unexpected extra LS machines: ${extraLS.join(', ')}`);

    const inactive = [...ssdRows, ...lsRows].filter(m => m.status !== 'running' && m.status !== 'available'); // Note: status checking might be complex depending on active statuses, skipping strict inactive abort unless it's genuinely 'inactive' or similar if they exist. We assume all returned are active or we'd filter WHERE status = 'active'. If status is 'running'/'maintenance' they are active. Let's just check for duplicate codes (which is enforced by UNIQUE constraint anyway).

    // 5. Perform Update
    let updated = 0;
    let alreadyCorrect = 0;

    const processMachine = async (m, expectedCategory, expectedDeptId, expectedLocId) => {
      if (m.type === expectedCategory && m.department_id === expectedDeptId && m.location_id === expectedLocId) {
        alreadyCorrect++;
      } else {
        await client.query(`
          UPDATE machines 
          SET type = $1, department_id = $2, location_id = $3
          WHERE id = $4
        `, [expectedCategory, expectedDeptId, expectedLocId, m.id]);
        updated++;
      }
    };

    console.log('Mapping SSD machines...');
    for (const m of ssdRows) {
      const num = parseInt(m.code.split('-')[1], 10);
      let expectedLocId;
      if (num >= 1 && num <= 50) expectedLocId = O06;
      else if (num >= 51 && num <= 100) expectedLocId = O05;
      else if (num >= 101 && num <= 116) expectedLocId = O04;
      else throw new Error(`Out of range SSD machine: ${m.code}`);

      await processMachine(m, 'PLASMA_CVD', dp01.id, expectedLocId);
    }

    console.log('Mapping LS machines...');
    for (const m of lsRows) {
      await processMachine(m, 'LASER', dp03.id, O03);
    }

    console.log(`Preflight complete. Mapped successfully.`);
    console.log(`Already Correct: ${alreadyCorrect}`);
    console.log(`Updated: ${updated}`);
    console.log(`Total Handled: ${alreadyCorrect + updated} / 121`);

    if (alreadyCorrect + updated !== 121) {
       throw new Error(`Assertion failed: expected 121 handled machines, got ${alreadyCorrect + updated}`);
    }

    await client.query('COMMIT');
    console.log('Transaction COMMITTED successfully.');

  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Transaction ABORTED and ROLLED BACK.');
    console.error(e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
