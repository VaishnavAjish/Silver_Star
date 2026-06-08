/**
 * ─── Silverstar Grow — Cursor-Based Pagination (Fixed) ─────────────────────
 *
 * Cursor pagination uses WHERE (date, id) < ($1, $2) ORDER BY date DESC, id DESC LIMIT $3
 * instead of LIMIT $3 OFFSET $offset, eliminating full table scans on deep pages.
 *
 * Supports single-field and composite-field cursors.
 * All parameter substitution is correct — no field names leaked as values.
 */

'use strict';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;

const CURSOR_SEPARATOR = '|';

/**
 * Decode a cursor string into an array of { field, value } pairs.
 * Format: "field1:val1|field2:val2"  (fields separated by pipes, field:value by colon)
 */
function decodeCursor(cursor) {
  if (!cursor) return null;
  const parts = cursor.split(CURSOR_SEPARATOR);
  const result = [];
  for (const part of parts) {
    const colonIdx = part.indexOf(':');
    if (colonIdx === -1) return null;
    const field = part.slice(0, colonIdx);
    const value = part.slice(colonIdx + 1);
    if (!field || value === '') return null;
    result.push({ field, value });
  }
  return result.length > 0 ? result : null;
}

/**
 * Encode a cursor from a row's sort fields.
 * @param {object} row - The last row from the current page
 * @param {string[]} sortFields - The sorted field names in order
 */
function encodeCursor(row, sortFields) {
  if (!row || !sortFields.length) return null;
  const parts = [];
  for (const field of sortFields) {
    const value = row[field];
    if (value === null || value === undefined) return null;
    parts.push(`${field}:${value}`);
  }
  return parts.join(CURSOR_SEPARATOR);
}

/**
 * Build WHERE clause for cursor-based pagination.
 *
 * For single-field sort (e.g. id DESC):
 *   WHERE id < $1
 *
 * For composite sort (e.g. date DESC, id DESC):
 *   WHERE (date, id) < ($1, $2)
 *
 * Uses PostgreSQL row-value comparison which is index-friendly.
 *
 * @param {Array<{field: string, value: string|number}>} cursorFields - Decoded cursor
 * @param {string[]} sortFields - Field names in sort order
 * @param {string} sortDir - 'ASC' or 'DESC'
 * @param {Array} params - Output parameter array (mutated)
 * @returns {string} WHERE clause fragment
 */
function buildCursorWhere(cursorFields, sortFields, sortDir, params) {
  if (!cursorFields || !cursorFields.length) return '';

  const op = sortDir === 'ASC' ? '>' : '<';

  if (sortFields.length === 1) {
    params.push(cursorFields[0].value);
    return `WHERE ${sortFields[0]} ${op} $${params.length}`;
  }

  // Composite: WHERE (field1, field2) <op> ($1, $2)
  const fieldList = sortFields.join(', ');
  const paramList = [];
  for (let i = 0; i < sortFields.length; i++) {
    params.push(cursorFields[i]?.value);
    paramList.push(`$${params.length}`);
  }
  return `WHERE (${fieldList}) ${op} (${paramList.join(', ')})`;
}

/**
 * Build paginated query from a base query + cursor + sort fields.
 *
 * @param {string} baseQuery - SQL query WITHOUT ORDER BY / LIMIT / OFFSET
 * @param {string[]} sortFields - Column names for ORDER BY (e.g. ['date', 'id'])
 * @param {string} [cursor] - Encoded cursor string from the previous response
 * @param {number} [limit] - Page size (default: 50, max: 500)
 * @param {string} [sortDir] - 'ASC' or 'DESC' (default: 'DESC')
 * @returns {{ query: string, params: Array, pageSize: number, hasMore: boolean }}
 */
function cursorPagination(baseQuery, sortFields, cursor, limit, sortDir = 'DESC') {
  const pageSize = Math.min(parseInt(limit) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const params = [];
  const dir = sortDir === 'ASC' ? 'ASC' : 'DESC';

  let whereClause = '';
  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (decoded) {
      whereClause = buildCursorWhere(decoded, sortFields, dir, params);
    }
  }

  const orderClause = sortFields.map(f => `${f} ${dir}`).join(', ');

  // Fetch 1 extra row to determine if there are more results
  const query = `${baseQuery} ${whereClause} ORDER BY ${orderClause} LIMIT ${pageSize + 1}`;

  return { query, params, pageSize };
}

/**
 * Process paginated results to separate data from the has-more indicator.
 * Returns { data, nextCursor }.
 *
 * @param {object[]} rows - Raw rows from the query (may include the extra row)
 * @param {number} pageSize - The requested page size
 * @param {string[]} sortFields - Sort field names for cursor encoding
 * @returns {{ data: object[], nextCursor: string|null }}
 */
function paginatedResult(rows, pageSize, sortFields) {
  const hasMore = rows.length > pageSize;
  const data = hasMore ? rows.slice(0, pageSize) : rows;
  const nextCursor = hasMore ? encodeCursor(data[data.length - 1], sortFields) : null;
  return { data, nextCursor };
}

module.exports = {
  decodeCursor,
  encodeCursor,
  cursorPagination,
  paginatedResult,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
};
