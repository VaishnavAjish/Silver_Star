'use strict';

// ============================================================================
// Disposable REAL PostgreSQL for tests (Windows-friendly, no Docker needed).
//
// Boots a throwaway cluster (initdb → pg_ctl start) in the OS temp directory,
// loads the repository schema dump (silverstar_grow_plain.sql — schema +
// empty operational data) and the post-dump migrations the Return Engine
// depends on (phase62 manufacturing_state, phase67 growth_diamond enum,
// phase89 legacy-reconstruction identity — the phase89 rollback is also
// scratch-tested here, then re-applied).
//
// Locate binaries via PG_TEST_BIN or the standard Program Files locations.
// Everything is destroyed on stop(). NEVER points at a live database.
// ============================================================================

const { execFileSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCHEMA_DUMP = path.join(REPO_ROOT, 'silverstar_grow_plain.sql');
const MIGRATIONS = path.join(REPO_ROOT, 'server', 'migrations');

function findPgBin() {
  const candidates = [
    process.env.PG_TEST_BIN,
    'C:\\Program Files\\PostgreSQL\\18\\bin',
    'C:\\Program Files\\PostgreSQL\\17\\bin',
    'C:\\Program Files\\PostgreSQL\\16\\bin',
    '/usr/lib/postgresql/16/bin',
    '/usr/local/pgsql/bin',
  ].filter(Boolean);
  for (const dir of candidates) {
    const initdb = path.join(dir, process.platform === 'win32' ? 'initdb.exe' : 'initdb');
    if (fs.existsSync(initdb)) return dir;
  }
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

class DisposablePg {
  constructor() {
    this.bin = findPgBin();
    this.dataDir = null;
    this.port = null;
    this.database = 'silverstar_test';
    this.user = 'postgres';
    this.started = false;
  }

  get available() { return this.bin != null; }

  exe(name) {
    return path.join(this.bin, process.platform === 'win32' ? `${name}.exe` : name);
  }

  run(name, args, opts = {}) {
    return execFileSync(this.exe(name), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      env: { ...process.env, PGPASSWORD: '' },
      ...opts,
    });
  }

  psql(args) {
    return this.run('psql', [
      '-h', '127.0.0.1', '-p', String(this.port), '-U', this.user,
      '-X', '-q', ...args,
    ]);
  }

  async start() {
    if (!this.available) throw new Error('No local PostgreSQL binaries found (set PG_TEST_BIN).');
    this.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssg-pg-'));
    const pgdata = path.join(this.dataDir, 'data');
    this.run('initdb', ['-D', pgdata, '-U', this.user, '-A', 'trust', '-E', 'UTF8', '--no-locale']);
    this.port = await freePort();
    // stdio must be fully ignored here: the postgres server inherits pg_ctl's
    // handles on Windows, so piped stdout/stderr would keep execFileSync
    // waiting for EOF forever even after pg_ctl itself exits.
    this.run('pg_ctl', [
      '-D', pgdata, '-w', '-t', '60',
      '-l', path.join(this.dataDir, 'pg.log'),
      '-o', `-p ${this.port} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off`,
      'start',
    ], { stdio: 'ignore' });
    this.started = true;
    this.run('createdb', ['-h', '127.0.0.1', '-p', String(this.port), '-U', this.user, this.database]);

    // Schema dump: ownership/extension noise is tolerated (ON_ERROR_STOP off),
    // but the tables the suite depends on are verified right after.
    this.psql(['-d', this.database, '-v', 'ON_ERROR_STOP=0', '-f', SCHEMA_DUMP]);
    const check = this.psql(['-d', this.database, '-t', '-A', '-c',
      "SELECT count(*) FROM information_schema.tables WHERE table_name IN " +
      "('inventory','lot_process_issues','lot_process_returns','process_return_lines'," +
      "'lot_op_log','machine_processes','machines','growth_run_cycles','items','process_master','users')"]);
    if (parseInt(check.trim(), 10) !== 11) {
      throw new Error(`Schema load incomplete — expected 11 core tables, got ${check.trim()}`);
    }

    // Post-dump migrations required by the Return Engine + this task.
    this.applyMigration('phase62-manufacturing-state.sql');
    this.applyMigration('phase67-growth-diamond-enum.sql');
    // Scratch-test phase89 forward → rollback → forward (the suite then runs
    // against the applied state, proving both scripts on real PostgreSQL).
    this.applyMigration('phase89-legacy-seed-reconstruction-identity.sql');
    this.applyMigration('phase89-legacy-seed-reconstruction-identity.rollback.sql');
    this.applyMigration('phase89-legacy-seed-reconstruction-identity.sql');
    return this;
  }

  applyMigration(fileName) {
    const file = path.join(MIGRATIONS, fileName);
    const out = this.run('psql', [
      '-h', '127.0.0.1', '-p', String(this.port), '-U', this.user,
      '-X', '-q', '-d', this.database, '-v', 'ON_ERROR_STOP=1', '-f', file,
    ]);
    return out;
  }

  connectionConfig() {
    return {
      host: '127.0.0.1', port: this.port, user: this.user,
      database: this.database, password: '', max: 20,
    };
  }

  stop() {
    if (!this.started) return;
    try {
      this.run('pg_ctl', ['-D', path.join(this.dataDir, 'data'), '-m', 'immediate', '-w', 'stop']);
    } catch (e) { /* already down */ }
    this.started = false;
    try { fs.rmSync(this.dataDir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
}

module.exports = { DisposablePg, findPgBin };
