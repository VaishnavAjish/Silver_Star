/**
 * Self-service navigation-preference validation. Pure (no I/O) so it is
 * unit-testable. Guards the /api/me/preferences endpoint: only a small
 * whitelist of nav.* keys may be written by an ordinary user, permission/role
 * keys are rejected, payloads are size-bounded, and nav.shortcuts must be a
 * versioned id list (slug ids only — never a URL).
 */

const ALLOWED_KEYS = new Set(['nav.shortcuts', 'nav.collapsed', 'nav.compact']);
// Any key whose name hints at authorization is refused outright.
const FORBIDDEN_SUBSTR = ['permission', 'role', 'rbac', 'admin', 'grant', 'allow'];
const MAX_VALUE_LEN = 4000;
const MAX_ITEMS = 20;
const ID_RE = /^[a-z0-9-]{1,64}$/i;

function isForbiddenKey(key) {
  const k = String(key).toLowerCase();
  return FORBIDDEN_SUBSTR.some(s => k.includes(s));
}

/** Validate the nav.shortcuts JSON string. Returns an error message or null. */
function validateShortcutValue(value) {
  let obj;
  try { obj = JSON.parse(value); } catch { return 'nav.shortcuts must be valid JSON'; }
  if (!obj || obj.v !== 1) return 'nav.shortcuts must be version 1';
  if (!Array.isArray(obj.ids)) return 'nav.shortcuts.ids must be an array';
  if (obj.ids.length > MAX_ITEMS) return `too many shortcut ids (max ${MAX_ITEMS})`;
  if (!obj.ids.every(id => typeof id === 'string' && ID_RE.test(id))) {
    return 'shortcut ids must be short slug strings (URLs are not allowed)';
  }
  if (obj.preset != null && typeof obj.preset !== 'string') return 'preset must be a string';
  return null;
}

/**
 * Validate a self-service preferences payload.
 * @returns {{ok:true, sanitized:Array}|{ok:false, error:string}}
 */
function validatePreferences(preferences) {
  if (!Array.isArray(preferences)) return { ok: false, error: 'preferences array required' };
  if (preferences.length > 10) return { ok: false, error: 'too many preferences in one request' };

  const sanitized = [];
  for (const p of preferences) {
    if (!p || typeof p.pref_key !== 'string') return { ok: false, error: 'each preference needs a string pref_key' };
    const key = p.pref_key;
    if (isForbiddenKey(key)) return { ok: false, error: `key '${key}' is not writable via self-service` };
    if (!ALLOWED_KEYS.has(key)) return { ok: false, error: `key '${key}' is not an allowed self-service preference` };

    const value = p.pref_value == null ? '' : String(p.pref_value);
    if (value.length > MAX_VALUE_LEN) return { ok: false, error: `value for '${key}' is too large` };
    if (key === 'nav.shortcuts' && value) {
      const err = validateShortcutValue(value);
      if (err) return { ok: false, error: err };
    }
    sanitized.push({ pref_key: key, pref_value: value });
  }
  return { ok: true, sanitized };
}

module.exports = { validatePreferences, validateShortcutValue, isForbiddenKey, ALLOWED_KEYS };
