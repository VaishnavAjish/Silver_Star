/**
 * Central Code Generator Service
 *
 * Provides consistent, transactional code generation backed by the
 * code_sequences table.  Uses SELECT FOR UPDATE row locking so concurrent
 * requests never produce the same code.
 *
 * Usage inside a transaction:
 *   const code = await reserveCode('vendor', client);
 *   const code = await reserveCode('fixed_asset', client, { date: '2026-05-12' });
 *
 * Non-transactional preview (UI hint only — may be stale):
 *   const code = await previewCode('vendor');
 */

const pool = require('../db/pool');

function buildCode(profile, value, context = {}) {
  const sep = profile.separator || '-';
  const num = profile.padding > 0
    ? String(value).padStart(profile.padding, '0')
    : String(value);

  if (profile.format_pattern === 'PREFIX-YYYYMM-SEQ') {
    const d      = context.date ? new Date(context.date) : new Date();
    const yyyymm = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
    return `${profile.prefix}${sep}${yyyymm}${sep}${num}`;
  }

  if (profile.format_pattern === 'PREFIX-YYYY-SEQ') {
    const d    = context.date ? new Date(context.date) : new Date();
    const yyyy = String(d.getFullYear());
    return `${profile.prefix}${sep}${yyyy}${sep}${num}`;
  }

  return `${profile.prefix}${sep}${num}`;
}

/**
 * Reserve the next code for an entity type.
 * Must be called inside an active transaction (BEGIN already issued on client).
 *
 * @param {string} entityType  - Matches code_sequences.entity_type
 * @param {object} client      - pg transaction client
 * @param {object} [context]   - Optional { date: 'YYYY-MM-DD' } for period-scoped formats
 * @returns {Promise<string>}  - Generated code, e.g. 'VND-000001'
 */
async function reserveCode(entityType, client, context = {}) {
  const lock = await client.query(
    `SELECT * FROM code_sequences WHERE entity_type = $1 AND active = true FOR UPDATE`,
    [entityType]
  );
  if (!lock.rows.length) {
    throw new Error(`Code sequence not configured for entity type: "${entityType}"`);
  }
  const profile = lock.rows[0];
  const code    = buildCode(profile, profile.next_value, context);

  await client.query(
    `UPDATE code_sequences SET next_value = next_value + 1, updated_at = NOW()
     WHERE entity_type = $1`,
    [entityType]
  );

  return code;
}

/**
 * Preview the next code without reserving it.
 * No transaction required.  Use only for UI preview — the actual reserved
 * code may differ if another request comes in first.
 *
 * @param {string} entityType
 * @param {object} [context]
 * @returns {Promise<string>}
 */
async function previewCode(entityType, context = {}) {
  const r = await pool.query(
    `SELECT * FROM code_sequences WHERE entity_type = $1 AND active = true`,
    [entityType]
  );
  if (!r.rows.length) {
    throw new Error(`Code sequence not configured for entity type: "${entityType}"`);
  }
  return buildCode(r.rows[0], r.rows[0].next_value, context);
}

module.exports = { reserveCode, previewCode };
