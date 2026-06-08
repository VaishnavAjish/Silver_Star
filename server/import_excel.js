require('dotenv').config();
const xlsx = require('xlsx');
const pool = require('./db/pool');

const filePath = "C:\\Users\\AXEL\\Desktop\\Machines_and_Vendors.xlsx";
const wb = xlsx.readFile(filePath);

function excelDateToJSDate(excelDate) {
  if (!excelDate) return null;
  const d = new Date((excelDate - 25569) * 86400 * 1000);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function importData() {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    // Import Machines
    const machines = xlsx.utils.sheet_to_json(wb.Sheets['Machines']);
    console.log(`Importing ${machines.length} machines...`);
    let machineCount = 0;
    for (const m of machines) {
      if (!m.code || !m.name) continue;
      const lastService = excelDateToJSDate(m.last_service);
      const nextService = excelDateToJSDate(m.next_service);
      
      const status = ['running', 'maintenance', 'idle'].includes(m.status) ? m.status : 'idle';

      await client.query(
        `INSERT INTO machines (code, name, type, last_service, next_service, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (code) DO UPDATE SET
           name = EXCLUDED.name,
           type = EXCLUDED.type,
           last_service = EXCLUDED.last_service,
           next_service = EXCLUDED.next_service,
           status = EXCLUDED.status`,
        [m.code, m.name, m.type || null, lastService, nextService, status]
      );
      machineCount++;
    }

    // Import Vendors
    const vendors = xlsx.utils.sheet_to_json(wb.Sheets['Vendors']);
    console.log(`Importing ${vendors.length} vendors...`);
    let vendorCount = 0;
    for (const v of vendors) {
      if (!v.code || !v.name) continue;
      
      const validCategories = ['seed', 'gas', 'consumable', 'general'];
      let category = (v.category || 'general').toLowerCase();
      if (!validCategories.includes(category)) category = 'general';

      const status = ['active', 'inactive'].includes(v.status) ? v.status : 'active';

      await client.query(
        `INSERT INTO vendors (code, name, category, contact_person, phone, email, address, city, state, gstin, pan, payment_term, bank_details, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (code) DO UPDATE SET
           name = EXCLUDED.name,
           category = EXCLUDED.category,
           contact_person = EXCLUDED.contact_person,
           phone = EXCLUDED.phone,
           email = EXCLUDED.email,
           address = EXCLUDED.address,
           city = EXCLUDED.city,
           state = EXCLUDED.state,
           gstin = EXCLUDED.gstin,
           pan = EXCLUDED.pan,
           payment_term = EXCLUDED.payment_term,
           bank_details = EXCLUDED.bank_details,
           status = EXCLUDED.status`,
        [
          v.code, v.name, category, v.contact_person || null, v.phone || null, v.email || null,
          v.address || null, v.city || null, v.state || null, v.gstin || null, v.pan || null,
          v.payment_term || 'Immediate', v.bank_details || null, status
        ]
      );
      vendorCount++;
    }

    await client.query('COMMIT');
    console.log(`Successfully imported ${machineCount} machines and ${vendorCount} vendors.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Import failed:', err);
  } finally {
    client.release();
    process.exit(0);
  }
}

importData();
