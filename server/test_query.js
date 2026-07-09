const pool = require('./db/pool');

async function testQuery() {
  try {
    let query = `
      SELECT t.*, 
             fa.name as from_account_name, fa.code as from_account_code,
             ta.name as to_account_name, ta.code as to_account_code,
             u.name as created_by_name
      FROM transfers t
      JOIN accounts fa ON t.from_account_id = fa.id
      JOIN accounts ta ON t.to_account_id = ta.id
      LEFT JOIN users u ON t.created_by = u.id
      WHERE 1=1
    `;
    const countQuery = `SELECT COUNT(*) FROM (${query}) AS c`;
    const countRes = await pool.query(countQuery, []);
    console.log('Count:', countRes.rows[0].count);

    query += ` ORDER BY t.transfer_date DESC, t.id DESC LIMIT $1 OFFSET $2`;
    const params = [50, 0];
    const result = await pool.query(query, params);
    console.log('Rows:', result.rows);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
}
testQuery();
