require('dotenv').config();
const pool = require('./db/pool');

const RUNTIME_SQL = `
  CASE
    WHEN mp.status = 'running' THEN
      ROUND(GREATEST(0,
        EXTRACT(EPOCH FROM (NOW() - mp.started_at))/3600
        - mp.total_paused_minutes/60.0
      )::numeric, 2)
    WHEN mp.status = 'hold' THEN
      ROUND(GREATEST(0,
        EXTRACT(EPOCH FROM (COALESCE(mp.paused_at, NOW()) - mp.started_at))/3600
        - mp.total_paused_minutes/60.0
      )::numeric, 2)
    ELSE
      ROUND(GREATEST(0,
        EXTRACT(EPOCH FROM (COALESCE(mp.completed_at, NOW()) - mp.started_at))/3600
        - mp.total_paused_minutes/60.0
      )::numeric, 2)
  END
`;

async function testQuery() {
  try {
    const { rows } = await pool.query(`
      SELECT * FROM (
        SELECT DISTINCT ON (m.id)
          m.id,
          m.code,
          m.name,
          m.type          AS machine_type,
          m.status::text  AS machine_status,
          m.department_id,
          d.name          AS department_name,
          l.name          AS location_name,
          m.capacity,
          m.next_service,
          mp.id                     AS process_id,
          mp.process_number,
          mp.process_type,
          mp.status                 AS process_status,
          mp.started_at,
          mp.paused_at,
          mp.expected_completion_at,
          mp.target_runtime_hours,
          mp.expected_rough_qty,
          mp.expected_height,
          mp.total_paused_minutes,
          mp.remarks                AS process_remarks,
          u.full_name               AS operator_name,
          mp.operator_id,
          ${RUNTIME_SQL} AS runtime_hours,
          (SELECT COALESCE(SUM(mpl.issued_qty), 0)
           FROM   machine_process_lots mpl
           WHERE  mpl.process_id = mp.id) AS seeds_issued,
          (SELECT COALESCE(SUM(mpm.qty), 0)
           FROM   machine_process_materials mpm
           WHERE  mpm.process_id = mp.id) AS materials_issued,
          gr.lot_number          AS growth_run_number,
          gr.id                  AS growth_run_id,
          gr.seed_height_at_in   AS seed_height,
          gr.dim_height          AS final_height,
          gr.actual_growth_mm    AS growth_mm,
          gr.weight_gain         AS weight_gain,
          gr.growth_pct          AS growth_pct,
          gr.weight              AS biscuit_weight,
          gr.status              AS biscuit_status
        FROM machines m
        LEFT JOIN departments d ON d.id = m.department_id
        LEFT JOIN locations   l ON l.id = m.location_id
        LEFT JOIN machine_processes mp
               ON mp.machine_id = m.id
              AND mp.status IN ('running','hold')
        LEFT JOIN users u ON u.id = mp.operator_id
        LEFT JOIN inventory gr
               ON gr.machine_process_id = mp.id
              AND gr.item_id = (SELECT id FROM items WHERE category = 'growth_run' LIMIT 1)
        WHERE 1=1
        ORDER BY m.id, CASE mp.status WHEN 'running' THEN 1 WHEN 'hold' THEN 2 ELSE 3 END
      ) sub
      ORDER BY
        CASE sub.machine_status
          WHEN 'running'          THEN 1
          WHEN 'awaiting_output'  THEN 2
          WHEN 'hold'             THEN 3
          WHEN 'breakdown'        THEN 4
          WHEN 'maintenance'      THEN 5
          WHEN 'cleaning'         THEN 6
          WHEN 'idle'             THEN 7
          ELSE 8
        END,
        sub.code
      LIMIT  500
      OFFSET 0
    `);
    console.log("Success! Returned " + rows.length + " rows.");
  } catch (e) {
    console.error("SQL Error:", e.message);
  } finally {
    process.exit(0);
  }
}
testQuery();
