require('dotenv').config();
const ExcelJS = require('exceljs');
const pool = require('./db/pool');

const filePath = "C:\\Users\\AXEL\\Desktop\\Machines_and_Vendors.xlsx";

function excelDateToJSDate(excelDate) {
  if (!excelDate) return null;
  const d = new Date((excelDate - 25569) * 86400 * 1000);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function importData() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    // Import Machines
    const machineSheet = wb.getWorksheet('Machines');
    const machines = [];
    if (machineSheet) {
      const headers = machineSheet.getRow(1).values;
      machineSheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) {
          const rowData = {};
          headers.forEach((h, i) => { if (h) rowData[h.toLowerCase()] = row.values[i]; });
          machines.push(rowData);
        }
      });
    }

    console.log(`Importing ${machines.length} machines...`);
    let machineCount = 0;
    for (const m of machines) {
      if (!m.code || !m.name) continue;
      const lastService = typeof m.last_service === 'number' ? excelDateToJSDate(m.last_service) : m.last_service;
      const nextService = typeof m.next_service === 'number' ? excelDateToJSDate(m.next_service) : m.next_service;
      
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
    const vendorSheet = wb.getWorksheet('Vendors');
    const vendors = [];
    if (vendorSheet) {
      const headers = vendorSheet.getRow(1).values;
      vendorSheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) {
          const rowData = {};
          headers.forEach((h, i) => { if (h) rowData[h.toLowerCase()] = row.values[i]; });
          vendors.push(rowData);
        }
      });
    }

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
