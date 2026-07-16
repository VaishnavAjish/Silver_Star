// Self-service preference validator — own-user key whitelist, no perm/role
// writes, versioned nav.shortcuts, no URLs, size limits. Pure (no DB).
const { test } = require('node:test');
const assert = require('node:assert');
const { validatePreferences } = require('../services/navPreferences');

test('rejects a non-array payload', () => {
  assert.equal(validatePreferences(null).ok, false);
  assert.equal(validatePreferences({}).ok, false);
});

test('#18: rejects permission/role keys outright', () => {
  assert.equal(validatePreferences([{ pref_key: 'user.role', pref_value: 'admin' }]).ok, false);
  assert.equal(validatePreferences([{ pref_key: 'permissions', pref_value: 'x' }]).ok, false);
  assert.equal(validatePreferences([{ pref_key: 'rbac_permissions', pref_value: 'x' }]).ok, false);
  assert.equal(validatePreferences([{ pref_key: 'is_admin', pref_value: '1' }]).ok, false);
});

test('rejects any non-whitelisted key', () => {
  assert.equal(validatePreferences([{ pref_key: 'foo.bar', pref_value: 'x' }]).ok, false);
});

test('accepts a valid nav.shortcuts payload', () => {
  const r = validatePreferences([{ pref_key: 'nav.shortcuts', pref_value: '{"v":1,"preset":"factory","ids":["control-tower","start-process"]}' }]);
  assert.equal(r.ok, true);
  assert.equal(r.sanitized.length, 1);
});

test('#16: rejects a URL masquerading as a shortcut id', () => {
  assert.equal(validatePreferences([{ pref_key: 'nav.shortcuts', pref_value: '{"v":1,"ids":["/inventory/secret"]}' }]).ok, false);
  assert.equal(validatePreferences([{ pref_key: 'nav.shortcuts', pref_value: '{"v":1,"ids":["http://x.y"]}' }]).ok, false);
});

test('#19: rejects invalid JSON and wrong version', () => {
  assert.equal(validatePreferences([{ pref_key: 'nav.shortcuts', pref_value: '{not json' }]).ok, false);
  assert.equal(validatePreferences([{ pref_key: 'nav.shortcuts', pref_value: '{"v":2,"ids":[]}' }]).ok, false);
});

test('rejects an oversized value', () => {
  assert.equal(validatePreferences([{ pref_key: 'nav.compact', pref_value: 'x'.repeat(5000) }]).ok, false);
});

test('accepts nav.compact / nav.collapsed', () => {
  const r = validatePreferences([{ pref_key: 'nav.compact', pref_value: '1' }, { pref_key: 'nav.collapsed', pref_value: '["sec-inventory"]' }]);
  assert.equal(r.ok, true);
  assert.equal(r.sanitized.length, 2);
});

test('rejects too many shortcut ids', () => {
  const ids = Array.from({ length: 25 }, (_, i) => `id-${i}`);
  assert.equal(validatePreferences([{ pref_key: 'nav.shortcuts', pref_value: JSON.stringify({ v: 1, ids }) }]).ok, false);
});
