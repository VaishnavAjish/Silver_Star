const { Pool } = require('pg');

const pool = new Pool({
  host: '54.235.46.178',
  user: 'ssg',
  password: 'Nidhi',
  database: 'silverstar_grow',
  ssl: false
});

async function run() {
  try {
    // 1. Fetch current lot to see what it is
    const current = await pool.query(`SELECT * FROM inventory WHERE lot_number = 'SSD109-APR26-021-R1'`);
    console.log("CURRENT:", current.rows[0]);

    if (!current.rows[0]) {
      console.log("Lot 'SSD109-APR26-021-R1' not found. It might have already been renamed.");
      const updated = await pool.query(`SELECT * FROM inventory WHERE lot_number = 'SSD109-APR26-021'`);
      console.log("Let's check 'SSD109-APR26-021' instead:", updated.rows[0]);
    }

    // 2. Perform the update
    const res = await pool.query(`
      UPDATE inventory 
      SET 
        lot_number = 'SSD109-APR26-021',
        qty = 28,
        weight = 310.22,
        dim_l = 12.50,
        dim_w = 12.50,
        dim_d = 4.36
      WHERE lot_number = 'SSD109-APR26-021-R1'
      RETURNING *
    `);
    
    if (res.rows.length > 0) {
      console.log("UPDATED SUCCESSFULLY:", res.rows[0]);
    } else {
      console.log("No rows were updated. Perhaps it was already renamed?");
      
      // If it was already renamed, let's update it anyway
      const res2 = await pool.query(`
        UPDATE inventory 
        SET 
          qty = 28,
          weight = 310.22,
          dim_l = 12.50,
          dim_w = 12.50,
          dim_d = 4.36
        WHERE lot_number = 'SSD109-APR26-021'
        RETURNING *
      `);
      console.log("UPDATED EXISTING 'SSD109-APR26-021' INSTEAD:", res2.rows[0]);
    }

  } catch (e) {
    console.error("ERROR:", e);
  } finally {
    pool.end();
  }
}

run();
