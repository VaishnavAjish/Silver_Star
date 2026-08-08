'use strict';

/**
 * RBAC Brick 7 — the server-side half of the Copy Setup staleness precondition.
 *
 * WHAT BRICK 6 LEFT OPEN
 *   Brick 6's wizard re-reads the preview immediately before Apply and compares
 *   fingerprints. That catches a target that moved while the admin was reading,
 *   but it is a check, not a precondition: between the client's re-read and the
 *   copy transaction's first statement there is a window in which another
 *   administrator can change the target. The copy then runs against state nobody
 *   reviewed. Brick 6's own comment says so and defers the fix to Brick 7.
 *
 * HOW BRICK 7 CLOSES IT
 *   The apply request carries the fingerprint the administrator actually
 *   reviewed. Inside the copy transaction — after `BEGIN`, after the target's
 *   `users` row is locked, before any DELETE — the server re-reads the same rows
 *   on the transaction client and recomputes the fingerprint. A mismatch rolls
 *   back and answers 409 STALE_COPY_PREVIEW. There is no window left: a
 *   competing write is either committed before our snapshot (and therefore
 *   visible to the recompute) or blocked on the row lock until we finish.
 *
 * BYTE-FOR-BYTE PARITY WITH THE CLIENT — LOAD-BEARING
 *   `stableStringify`, the FNV-1a constants and the exact output format are
 *   transcribed from the client's copySetupPreviewModel.js. They must stay
 *   identical: the client fingerprints the JSON it received and the server
 *   fingerprints the rows it read, so any divergence makes every apply 409 and
 *   Copy Setup stops working entirely.
 *
 *   Note the format detail that is easy to get wrong: the trailing length is NOT
 *   zero-padded here, unlike concurrencyService.digest(). That is why this file
 *   does not reuse `digest` — matching the client matters more than internal
 *   consistency, and a parity test in server/tests/ pins both directions.
 *
 * WHY JSON ROUND-TRIPPING IS SAFE HERE
 *   The client digests values that survived `JSON.stringify` over the wire; the
 *   server digests the raw `pg` row objects. Those agree only because every
 *   column in the preview is a JSON primitive — INTEGER, VARCHAR, BOOLEAN.
 *   `loadCopyCategoryState` selects no TIMESTAMPTZ, NUMERIC or BIGINT column,
 *   which would arrive as a Date or a string on one side and something else on
 *   the other. Adding such a column to the preview WILL break parity silently,
 *   so it must be excluded from the fingerprint material if it is ever added.
 */

/** Category order — must match the client's CATEGORY_ORDER exactly. */
const CATEGORY_ORDER = Object.freeze([
  'permissions',
  'visibility',
  'preferences',
  'dashboard',
  'templates',
]);

/** Transcribed from copySetupPreviewModel.js. Do not "improve" independently. */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function fnv1a32(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Digest of the TARGET's stored state across all five categories.
 *
 * Templates are special-cased to `shares` only because the target side's
 * `owned_non_global` is always an empty array by construction — the copy shares
 * the SOURCE's owned templates and never reads the target's — so digesting it
 * would add bytes that can never change.
 */
function fingerprintTargetState(payload) {
  const categories = payload?.categories || {};
  const material = CATEGORY_ORDER.map((key) => {
    const side = categories[key]?.target;
    if (key === 'templates') return [key, side?.shares || []];
    return [key, side ?? null];
  });

  const text = stableStringify(material);
  return `fp1_${fnv1a32(text).toString(16).padStart(8, '0')}_${text.length}`;
}

/**
 * Digest of everything the copy READS — both sides.
 *
 * The precondition uses this one rather than the target-only digest: a SOURCE
 * that changed after the preview was generated would produce a copy the
 * administrator never reviewed, exactly as a changed target would.
 */
function fingerprintCopyState(payload) {
  const categories = payload?.categories || {};
  const material = CATEGORY_ORDER.map(key => [key, categories[key]?.source ?? null]);
  const text = stableStringify(material);

  return `${fingerprintTargetState(payload)}~s${fnv1a32(text).toString(16).padStart(8, '0')}`;
}

/**
 * Assemble the exact payload shape the `fingerprint*` functions expect, from
 * per-user category state, so the preview route and the apply transaction cannot
 * drift apart in how they build it.
 *
 * `excluded_key_prefix` is deliberately absent: it is a constant of the response
 * shape, not stored state, and including it would make the digest depend on a
 * documentation field rather than on what the copy will read.
 */
function buildFingerprintPayload({ sourceState, targetState, sourceOwnedTemplates = [] }) {
  return {
    categories: {
      permissions: { source: sourceState.permissions, target: targetState.permissions },
      visibility: { source: sourceState.visibility, target: targetState.visibility },
      preferences: { source: sourceState.preferences, target: targetState.preferences },
      dashboard: { source: sourceState.dashboard, target: targetState.dashboard },
      templates: {
        source: { shares: sourceState.templates, owned_non_global: sourceOwnedTemplates },
        target: { shares: targetState.templates, owned_non_global: [] },
      },
    },
  };
}

module.exports = {
  CATEGORY_ORDER,
  stableStringify,
  fnv1a32,
  fingerprintTargetState,
  fingerprintCopyState,
  buildFingerprintPayload,
};
