'use strict';

/**
 * RBAC Brick 7 — phase87 migration contract.
 *
 * NO DATABASE IS CONTACTED, and that is a limitation this file states rather
 * than hides. The development environment's DB_HOST points at the production
 * server and no disposable PostgreSQL instance is available here, so the
 * migration is NOT execution-tested. What IS tested is every property that can
 * be established from the SQL text itself — and those are the properties that
 * decide whether the migration is safe to run:
 *
 *   - it is purely additive: no DROP, no rename, no type change, no data write
 *   - it cannot rewrite a table on ANY PostgreSQL version
 *   - it touches no frozen table (roles, permissions, overrides, scope, prefs)
 *   - it is reversible, and the rollback undoes exactly what the UP added
 *   - it is idempotent, so a partial application can simply be re-run
 *
 * WHAT STILL NEEDS A REAL DATABASE (for the deployment review, not for today):
 *   applying it to a scratch schema, applying it with existing refresh tokens
 *   present, and confirming the index builds. Those are listed in the final
 *   report as execution-untested.
 *
 * Run: node --test server/tests/brick7Migration.test.js
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

after(async () => {
  try {
    const poolPath = require.resolve('../db/pool');
    if (require.cache[poolPath]) {
      const p = require(poolPath);
      if (typeof p.shutdown === 'function') await p.shutdown();
      else if (p.primaryPool && typeof p.primaryPool.end === 'function') await p.primaryPool.end();
    }
  } catch (e) {}
});

const MIGRATIONS = path.join(__dirname, '..', 'migrations');
const UP_FILE = path.join(MIGRATIONS, 'phase87-session-security-hardening.sql');
const DOWN_FILE = path.join(MIGRATIONS, 'phase87-session-security-hardening.rollback.sql');

const read = file => fs.readFileSync(file, 'utf8');

/** SQL with comments removed — a comment quoting a DROP is not a DROP. */
function statementsOf(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map(line => line.replace(/--.*$/, ''))
    .join('\n');
}

const UP = statementsOf(read(UP_FILE));
const DOWN = statementsOf(read(DOWN_FILE));

/* Every table whose CONTENT Brick 7 froze. The migration must not name any of
   them in a write, because doing so would risk changing an effective permission
   — the one thing this brick promises not to do. */
const FROZEN_TABLES = [
  'roles', 'role_permissions', 'user_roles',
  'user_permission_overrides', 'user_permissions',
  'user_inventory_scopes', 'user_inventory_scope_depts',
  'user_preferences', 'user_dashboard_widgets', 'template_shares',
];

/* ══════════════════════════════════════════════════════════════════════════
   The files exist and are paired
   ══════════════════════════════════════════════════════════════════════════ */

test('the migration ships with a rollback', () => {
  assert.ok(fs.existsSync(UP_FILE), 'the UP migration is missing');
  assert.ok(fs.existsSync(DOWN_FILE), 'the migration has no rollback');
});

test('both files are transactional', () => {
  for (const [name, sql] of [['UP', UP], ['DOWN', DOWN]]) {
    assert.match(sql, /\bBEGIN\b/, `${name} does not open a transaction`);
    assert.match(sql, /\bCOMMIT\b/, `${name} does not commit`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   Additive only
   ══════════════════════════════════════════════════════════════════════════ */

test('the UP migration adds exactly the three columns Brick 7 needs', () => {
  assert.match(UP, /ALTER TABLE users\s+ADD COLUMN IF NOT EXISTS auth_version INTEGER/i);
  assert.match(UP, /ALTER TABLE refresh_tokens\s+ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ/i);
  assert.match(UP, /ALTER TABLE refresh_tokens\s+ADD COLUMN IF NOT EXISTS revoked_reason VARCHAR\(64\)/i);

  const added = UP.match(/ADD COLUMN IF NOT EXISTS (\w+)/gi) || [];
  assert.equal(added.length, 3, `the UP migration adds ${added.length} columns, expected 3`);
});

test('the UP migration drops nothing and renames nothing', () => {
  assert.equal(/\bDROP\s+(TABLE|COLUMN|CONSTRAINT)\b/i.test(UP), false,
    'the UP migration drops a table, column or constraint');
  assert.equal(/\bRENAME\b/i.test(UP), false, 'the UP migration renames something');
  assert.equal(/\bALTER COLUMN\s+\w+\s+TYPE\b/i.test(UP), false,
    'the UP migration changes a column type, which rewrites the table');
  assert.equal(/\bSET NOT NULL\b/i.test(UP), false,
    'the UP migration adds a NOT NULL constraint, which scans the whole table');
});

test('the UP migration writes no row data at all', () => {
  for (const verb of ['INSERT INTO', 'UPDATE', 'DELETE FROM', 'TRUNCATE']) {
    assert.equal(new RegExp(`\\b${verb}\\b`, 'i').test(UP), false,
      `the UP migration contains a ${verb} — it must not touch any row`);
  }
});

test('the UP migration names no frozen table', () => {
  for (const table of FROZEN_TABLES) {
    assert.equal(
      new RegExp(`(ALTER TABLE|INSERT INTO|UPDATE|DELETE FROM|TRUNCATE)\\s+${table}\\b`, 'i').test(UP),
      false,
      `the migration writes to ${table}, whose content Brick 7 freezes`,
    );
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   Cannot rewrite a table on any PostgreSQL version
   ══════════════════════════════════════════════════════════════════════════ */

test('no ADD COLUMN carries an inline DEFAULT, which would rewrite on PostgreSQL 10', () => {
  /* `ADD COLUMN x INT NOT NULL DEFAULT 1` is rewrite-free only on PostgreSQL 11+,
     where the default is stored in pg_attribute.attmissingval. On 10 and older it
     rewrites the whole table under ACCESS EXCLUSIVE. We do not depend on the
     deployed version, so the default is applied by a SEPARATE, catalog-only
     statement instead. */
  const addColumns = UP.match(/ADD COLUMN IF NOT EXISTS[^;,]*/gi) || [];
  assert.ok(addColumns.length > 0, 'no ADD COLUMN clauses were found to check');
  for (const clause of addColumns) {
    assert.equal(/\bDEFAULT\b/i.test(clause), false,
      `an ADD COLUMN carries an inline DEFAULT and may rewrite the table: ${clause.trim()}`);
    assert.equal(/\bNOT NULL\b/i.test(clause), false,
      `an ADD COLUMN is NOT NULL, which requires a full table scan: ${clause.trim()}`);
  }

  // The default is still applied — just separately, where it is metadata-only.
  assert.match(UP, /ALTER TABLE users\s+ALTER COLUMN auth_version SET DEFAULT 1/i);
});

test('the index is created IF NOT EXISTS and is partial', () => {
  assert.match(UP, /CREATE INDEX IF NOT EXISTS idx_refresh_tokens_active/i);
  assert.match(UP, /WHERE revoked_at IS NULL AND used_at IS NULL/i);
  // CONCURRENTLY cannot appear inside a transaction block; the out-of-transaction
  // variant is documented in the rollback file's appendix instead.
  assert.equal(/CREATE INDEX CONCURRENTLY/i.test(UP), false,
    'CREATE INDEX CONCURRENTLY cannot run inside the BEGIN/COMMIT this file uses');
});

/* ══════════════════════════════════════════════════════════════════════════
   Idempotent
   ══════════════════════════════════════════════════════════════════════════ */

test('every UP statement is safe to re-run after a partial application', () => {
  const adds = UP.match(/ADD COLUMN[^;,]*/gi) || [];
  for (const clause of adds) {
    assert.match(clause, /IF NOT EXISTS/i, `not idempotent: ${clause.trim()}`);
  }
  const indexes = UP.match(/CREATE INDEX[^;]*/gi) || [];
  assert.ok(indexes.length > 0);
  for (const clause of indexes) {
    assert.match(clause, /IF NOT EXISTS/i, `not idempotent: ${clause.trim()}`);
  }
});

test('every DOWN statement tolerates an already-rolled-back schema', () => {
  const drops = DOWN.match(/DROP (COLUMN|INDEX)[^;,]*/gi) || [];
  assert.ok(drops.length > 0, 'the rollback drops nothing');
  for (const clause of drops) {
    assert.match(clause, /IF EXISTS/i, `not idempotent: ${clause.trim()}`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   Reversible — the rollback undoes exactly the UP, and no more
   ══════════════════════════════════════════════════════════════════════════ */

test('the rollback drops precisely what the migration added', () => {
  const added = (UP.match(/ADD COLUMN IF NOT EXISTS (\w+)/gi) || [])
    .map(m => m.split(/\s+/).pop().toLowerCase()).sort();
  const dropped = (DOWN.match(/DROP COLUMN IF EXISTS (\w+)/gi) || [])
    .map(m => m.split(/\s+/).pop().toLowerCase()).sort();

  assert.deepEqual(dropped, added,
    'the rollback does not undo exactly the columns the migration added');

  assert.match(DOWN, /DROP INDEX IF EXISTS idx_refresh_tokens_active/i);
});

test('the rollback touches no frozen table and deletes no row', () => {
  for (const table of FROZEN_TABLES) {
    assert.equal(
      new RegExp(`(ALTER TABLE|INSERT INTO|UPDATE|DELETE FROM|TRUNCATE)\\s+${table}\\b`, 'i').test(DOWN),
      false,
      `the rollback writes to ${table}`,
    );
  }
  for (const verb of ['INSERT INTO', 'UPDATE', 'DELETE FROM', 'TRUNCATE']) {
    assert.equal(new RegExp(`\\b${verb}\\b`, 'i').test(DOWN), false,
      `the rollback contains a ${verb}`);
  }
  assert.equal(/DROP TABLE/i.test(DOWN), false, 'the rollback drops a table');
});

/* ══════════════════════════════════════════════════════════════════════════
   Documented deployment risk
   ══════════════════════════════════════════════════════════════════════════ */

test('the rollback warns that it must not run under the phase87 backend', () => {
  const raw = read(DOWN_FILE);
  assert.match(raw, /roll the backend back/i,
    'the rollback does not state the required ordering');
  assert.match(raw, /42703|undefined_column/i,
    'the rollback does not state what breaks if it is run under the new backend');
});

test('the migration documents its lock and rewrite characteristics', () => {
  const raw = read(UP_FILE);
  assert.match(raw, /ACCESS EXCLUSIVE/i, 'lock characteristics are undocumented');
  assert.match(raw, /rewrite/i, 'table-rewrite behaviour is undocumented');
  assert.match(raw, /PostgreSQL 11/i, 'the version dependency is undocumented');
});

test('the column names the migration adds are the ones the code reads', () => {
  /* A migration that added the right columns under the wrong names would pass
     every text assertion above and still fail in production. These are the exact
     identifiers the services use. */
  const versionService = read(path.join(__dirname, '..', 'services', 'security', 'securityVersionService.js'));
  const sessionService = read(path.join(__dirname, '..', 'services', 'security', 'sessionInvalidationService.js'));

  assert.match(versionService, /auth_version/, 'securityVersionService does not read auth_version');
  assert.match(sessionService, /revoked_at/, 'sessionInvalidationService does not write revoked_at');
  assert.match(sessionService, /revoked_reason/, 'sessionInvalidationService does not write revoked_reason');
});
