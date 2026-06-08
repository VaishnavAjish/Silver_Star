// Seed Lot Genealogy Code Generator
// Only applies to items where category = 'seed'.
// Non-seed inventory is untouched by this service.

/** Convert 0→A, 1→B, …, 25→Z, 26→AA, 27→AB … */
function getSuffix(idx) {
  let s = '', n = idx;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Inverse of getSuffix — 'A'→0, 'B'→1, 'Z'→25, 'AA'→26 */
function alphaToIndex(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    n = n * 26 + (s.charCodeAt(i) - 64);
  }
  return n - 1;
}

function isSeedItem(item) {
  return item && item.category === 'seed';
}

/** Consume next purchase lot code from sequence. Returns e.g. '1001'. */
async function nextPurchaseLotCode(client) {
  const { rows } = await client.query("SELECT nextval('seed_lot_seq') as n");
  return String(rows[0].n);
}

/** Consume next mix lot code from sequence. Returns e.g. 'MX0001'. */
async function nextMixLotCode(client) {
  const { rows } = await client.query("SELECT nextval('seed_mix_seq') as n");
  return `MX${String(rows[0].n).padStart(4, '0')}`;
}

/**
 * Generate the next sibling lot code for a split child by querying existing
 * direct children of the parent from the DB.
 *
 * This is the safe, DB-driven replacement for the stateless childSplitCode().
 * Must be called AFTER the parent row is locked (FOR UPDATE) in the transaction
 * to prevent concurrent race conditions.
 *
 * Level 0 (purchase → first split):  '1001'     → '1001-01', '1001-02', '1001-03'
 * Level 1 (first → second split):    '1001-01'  → '1001-01A', '1001-01B'
 * Level 2 (second → third split):    '1001-01A' → '1001-01A1', '1001-01A2'
 * Level 3+ (deeper):                 extend with _N suffix
 *
 * @param {object} db          pool or client — anything with .query(sql, params)
 * @param {string} parentCode  parent's lot_code
 * @param {number} parentLevel parent's split_level (0 for purchase lots)
 * @param {number} parentId    parent's inventory.id
 * @returns {Promise<string>}  next child lot code
 */
async function nextSiblingCode(db, parentCode, parentLevel, parentId) {
  const level = parentLevel || 0;

  const { rows } = await db.query(
    'SELECT lot_code FROM inventory WHERE parent_lot_id = $1',
    [parentId]
  );

  if (level === 0) {
    // Pattern: parentCode-NN (2-padded numeric)
    const prefix = `${parentCode}-`;
    let maxN = 0;
    for (const row of rows) {
      if (row.lot_code && row.lot_code.startsWith(prefix)) {
        const n = parseInt(row.lot_code.slice(prefix.length), 10);
        if (!isNaN(n) && n > maxN) maxN = n;
      }
    }
    return `${parentCode}-${String(maxN + 1).padStart(2, '0')}`;

  } else if (level === 1) {
    // Pattern: parentCode + alpha suffix (A, B, ..., Z, AA, ...)
    let maxIdx = -1;
    for (const row of rows) {
      if (row.lot_code && row.lot_code.startsWith(parentCode)) {
        const suffix = row.lot_code.slice(parentCode.length);
        if (/^[A-Z]+$/.test(suffix)) {
          const idx = alphaToIndex(suffix);
          if (idx > maxIdx) maxIdx = idx;
        }
      }
    }
    return `${parentCode}${getSuffix(maxIdx + 1)}`;

  } else if (level === 2) {
    // Pattern: parentCode + numeric digit(s)
    let maxN = 0;
    for (const row of rows) {
      if (row.lot_code && row.lot_code.startsWith(parentCode)) {
        const suffix = row.lot_code.slice(parentCode.length);
        const n = parseInt(suffix, 10);
        if (!isNaN(n) && n > maxN) maxN = n;
      }
    }
    return `${parentCode}${maxN + 1}`;

  } else {
    // Level 3+: parentCode_N
    const prefix = `${parentCode}_`;
    let maxN = 0;
    for (const row of rows) {
      if (row.lot_code && row.lot_code.startsWith(prefix)) {
        const n = parseInt(row.lot_code.slice(prefix.length), 10);
        if (!isNaN(n) && n > maxN) maxN = n;
      }
    }
    return `${parentCode}_${maxN + 1}`;
  }
}

/**
 * Stateless code generator — kept for backward compatibility and preview use
 * when no DB query is desired. Do NOT use for execute paths; use nextSiblingCode.
 */
function childSplitCode(parentCode, parentSplitLevel, childIndex) {
  const level = parentSplitLevel || 0;
  if (level === 0) {
    return `${parentCode}-${String(childIndex + 1).padStart(2, '0')}`;
  } else if (level === 1) {
    return `${parentCode}${getSuffix(childIndex)}`;
  } else if (level === 2) {
    return `${parentCode}${childIndex + 1}`;
  } else {
    return `${parentCode}_${childIndex + 1}`;
  }
}

/**
 * Generate the next unique Lot Operational ID from the DB sequence.
 * Returns a BIGINT (6+ digits, e.g. 100001) suitable for barcode/scanner use.
 * Must be called within an active transaction client to guarantee uniqueness.
 */
async function nextLotOpId(client) {
  const { rows } = await client.query("SELECT nextval('lot_op_id_seq') as n");
  return parseInt(rows[0].n, 10);
}

/**
 * Generate the next manufacturing process number from the DB sequence.
 * Returns format PR-000001, PR-000002, etc. — globally unique, concurrency-safe.
 * Must be called within an active transaction client.
 */
async function nextMfgProcessNumber(client) {
  const { rows } = await client.query("SELECT nextval('machine_process_seq') as n");
  return `PR-${String(rows[0].n).padStart(6, '0')}`;
}

module.exports = { isSeedItem, nextPurchaseLotCode, nextMixLotCode, childSplitCode, nextSiblingCode, getSuffix, nextLotOpId, nextMfgProcessNumber };
