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
    const [O01, O03, O04, O05, O06] = ['001', '003', '004', '005', '006'].map(getLocId);

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
    const { rows: ssdRows } = await client.query(`SELECT id, code, name, status, type, department_id, location_id FROM machines WHERE name LIKE 'SSD-%' FOR UPDATE`);
    const { rows: lsRows } = await client.query(`SELECT id, code, name, status, type, department_id, location_id FROM machines WHERE name LIKE 'LS-%' FOR UPDATE`);

    console.log(`Found ${ssdRows.length} SSD machines and ${lsRows.length} LS machines.`);

    const expectedSSDNames = new Set();
    for(let i=1; i<=116; i++) expectedSSDNames.add(`SSD-${String(i).padStart(3, '0')}`);
    
    const expectedLSNames = new Set();
    for(let i=1; i<=5; i++) expectedLSNames.add(`LS-${String(i).padStart(2, '0')}`);

    const actualSSDNames = new Set(ssdRows.map(m => m.name));
    const actualLSNames = new Set(lsRows.map(m => m.name));

    const missingSSD = [...expectedSSDNames].filter(c => !actualSSDNames.has(c));
    const missingLS = [...expectedLSNames].filter(c => !actualLSNames.has(c));

    if (missingSSD.length > 0) throw new Error(`Missing SSD machines: ${missingSSD.join(', ')}`);
    if (missingLS.length > 0) throw new Error(`Missing LS machines: ${missingLS.join(', ')}`);

    // 5. Perform Update
    let updated = 0;
    
    console.log(`Updating ${ssdRows.length} SSD machines...`);
    for (const m of ssdRows) {
      const num = parseInt(m.name.split('-')[1], 10);
      let expectedLocId;
      if (num >= 1 && num <= 50) expectedLocId = O06;
      else if (num >= 51 && num <= 100) expectedLocId = O05;
      else if (num >= 101 && num <= 116) expectedLocId = O04;
      else throw new Error(`Out of range SSD machine: ${m.name}`);

      await client.query(`
        UPDATE machines 
        SET type = $1, department_id = $2, location_id = $3
        WHERE id = $4
      `, ['PLASMA_CVD', dp01.id, expectedLocId, m.id]);
      updated++;
    }

    console.log(`Updating ${lsRows.length} LS machines...`);
    for (const m of lsRows) {
      await client.query(`
        UPDATE machines 
        SET type = $1, department_id = $2, location_id = $3
        WHERE id = $4
      `, ['LASER', dp03.id, O03, m.id]);
      updated++;
    }

    if (updated !== 121) {
       throw new Error(`Assertion failed: expected 121 handled machines, got ${updated}`);
    }

    await client.query('COMMIT');
    console.log('Transaction COMMITTED successfully.');
    console.log(`SUCCESS! Mapped ${updated} machines to canonical definitions.`);

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
