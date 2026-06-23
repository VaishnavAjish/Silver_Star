const pool = require('./db/pool');

async function testQuery() {
  try {
    const q = `
      SELECT t.*, u.first_name, u.last_name 
      FROM inventory_templates t
      LEFT JOIN users u ON t.created_by = u.id
      WHERE t.created_by = $1 
         OR t.is_global = true
         OR t.id IN (SELECT template_id FROM template_shares WHERE user_id = $1)
      ORDER BY t.created_at DESC
    `;
    const res = await pool.query(q, [1]);
    console.log('Query success:', res.rowCount);
  } catch (err) {
    console.error('Query error:', err);
  } finally {
    process.exit(0);
  }
}

testQuery();
