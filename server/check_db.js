require('dotenv').config();
const { Client } = require('pg');

async function run() {
  const client = new Client();
  await client.connect();

  console.log("=== ENUM VALUES ===");
  const res1 = await client.query(`
    SELECT e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'item_category'
    ORDER BY e.enumsortorder;
  `);
  console.log(res1.rows.map(r => r.enumlabel));

  console.log("\n=== ITEMS TABLE CATEGORY COLUMN ===");
  const res2 = await client.query(`
    SELECT data_type, udt_name
    FROM information_schema.columns
    WHERE table_name = 'items' AND column_name = 'category';
  `);
  console.log(res2.rows);

  console.log("\n=== GROWTH DIAMOND ITEMS ===");
  const res3 = await client.query(`
    SELECT id, code, name, category, active
    FROM items
    WHERE lower(code) IN ('growth diamond', 'growth_diamond')
       OR lower(name) = 'growth diamond'
    ORDER BY id;
  `);
  console.log(res3.rows);

  await client.end();
}

run().catch(console.error);
