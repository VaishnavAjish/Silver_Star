// Pure selector tests — run with `node --test`. No React/DOM required.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  isEntryVisible, filterNavigation, filterPages, filterCreateActions,
  resolveShortcutIds, sanitizeShortcutIds, parseShortcutPref, serializeShortcutPref,
} from './selectors.js';

// ctx builder: role + a set of "module.action[.submodule]" permission keys.
function ctx({ role = 'operator', perms = [] } = {}) {
  const set = new Set(perms);
  return {
    hasRole: (...roles) => roles.map(r => r.toLowerCase()).includes(role.toLowerCase()),
    hasPermission: (m, a, s) => {
      if (role === 'admin' || role === 'super_admin') return true;
      return set.has(s ? `${m}.${a}.${s}` : `${m}.${a}`);
    },
  };
}

const nav = [
  { id: 'dash', label: 'Dashboard', path: '/', module: 'dashboard', submodule: 'dashboard', pinnable: true, searchable: true },
  { id: 'sec-mfg', label: 'Manufacturing', children: [
    { id: 'process-issues', label: 'Process Issues', path: '/inventory/process-issues', module: 'inventory', submodule: 'process_issues', pinnable: true, searchable: true },
    { id: 'start-process', label: 'Start Process', path: '/inventory/process-issues/new', module: 'inventory', editorOnly: true, pinnable: true, searchable: true },
  ] },
  { id: 'sec-empty', label: 'Empty', children: [
    { id: 'secret', label: 'Secret', path: '/secret', module: 'admin', submodule: 'x' },
  ] },
  { id: 'admin', label: 'Admin', path: '/admin/users', module: 'admin', submodule: 'users', adminOnly: true },
];
const create = [
  { id: 'create-journal-entry', label: 'Journal Entry', path: '/journal-entries/new', module: 'accounting', requiredAction: 'create', pinnable: true },
];

test('isEntryVisible: adminOnly requires admin/super_admin role', () => {
  assert.equal(isEntryVisible(nav[3], ctx({ role: 'operator' })), false);
  assert.equal(isEntryVisible(nav[3], ctx({ role: 'admin' })), true);
});

test('#11: editor-only hidden for viewer without create/edit', () => {
  const sp = nav[1].children[1];
  assert.equal(isEntryVisible(sp, ctx({ role: 'viewer', perms: [] })), false);
  assert.equal(isEntryVisible(sp, ctx({ role: 'operator', perms: ['inventory.create'] })), true);
});

test('#12: operator sees only permitted submodule entries', () => {
  const pi = nav[1].children[0];
  assert.equal(isEntryVisible(pi, ctx({ role: 'operator', perms: [] })), false);
  assert.equal(isEntryVisible(pi, ctx({ role: 'operator', perms: ['inventory.sidebar.process_issues'] })), true);
});

test('#26: empty permission-filtered groups are dropped', () => {
  const out = filterNavigation(nav, ctx({ role: 'operator', perms: ['inventory.sidebar.process_issues', 'inventory.create'] }));
  const ids = out.map(n => n.id);
  assert.ok(ids.includes('sec-mfg'));
  assert.ok(!ids.includes('sec-empty'));  // its only child needs admin.sidebar.x
  assert.ok(!ids.includes('admin'));      // adminOnly
});

test('#14: filterPages hides inaccessible pages', () => {
  const pages = filterPages(nav, ctx({ role: 'operator', perms: ['inventory.sidebar.process_issues'] }));
  const paths = pages.map(p => p.path);
  assert.ok(paths.includes('/inventory/process-issues'));
  assert.ok(!paths.includes('/admin/users'));
  assert.ok(!paths.includes('/secret'));
});

test('#15: filterCreateActions hides actions without create permission', () => {
  assert.equal(filterCreateActions(create, ctx({ role: 'operator', perms: [] })).length, 0);
  assert.equal(filterCreateActions(create, ctx({ role: 'operator', perms: ['accounting.create'] })).length, 1);
  assert.equal(filterCreateActions(create, ctx({ role: 'admin' })).length, 1);
});

// Shortcut resolution
const entries = new Map([...nav[1].children, ...create, nav[0]].map(e => [e.id, e]));
const getEntry = (id) => entries.get(id) || null;

test('#16/#20/#21: resolveShortcutIds skips unknown, non-pinnable, and unpermitted', () => {
  const c = ctx({ role: 'operator', perms: ['inventory.sidebar.process_issues', 'dashboard.sidebar.dashboard'] });
  const out = resolveShortcutIds(
    ['process-issues', 'does-not-exist', 'secret', 'process-issues', 'start-process', 'dash'],
    getEntry, c
  );
  const ids = out.map(e => e.id);
  assert.deepEqual(ids, ['process-issues', 'dash']); // unknown+dup skipped; start-process lacks create; secret not pinnable
});

test('resolveShortcutIds preserves order', () => {
  const c = ctx({ role: 'admin' });
  const out = resolveShortcutIds(['dash', 'process-issues'], getEntry, c).map(e => e.id);
  assert.deepEqual(out, ['dash', 'process-issues']);
});

test('sanitizeShortcutIds prunes unknown/non-pinnable and dedups', () => {
  assert.deepEqual(sanitizeShortcutIds(['dash', 'dash', 'secret', 'nope'], getEntry), ['dash']);
});

test('#19: parseShortcutPref falls back safely on garbage', () => {
  assert.deepEqual(parseShortcutPref('{bad', 'factory'), { preset: 'factory', ids: null });
  assert.deepEqual(parseShortcutPref('{"v":2,"ids":[]}', 'factory'), { preset: 'factory', ids: null });
  assert.deepEqual(parseShortcutPref('{"v":1,"preset":"accounts","ids":["a"]}'), { preset: 'accounts', ids: ['a'] });
});

test('serializeShortcutPref round-trips', () => {
  const s = serializeShortcutPref(['a', 'b'], 'factory');
  assert.deepEqual(parseShortcutPref(s), { preset: 'factory', ids: ['a', 'b'] });
});
