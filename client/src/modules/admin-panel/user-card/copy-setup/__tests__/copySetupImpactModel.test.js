import { describe, it, expect } from 'vitest';
import { buildBaseline } from '../../permissions/permissionEditorModel';
import {
  DIRECTION,
  buildPermissionImpact,
  IMPACT_UNAVAILABLE_NOTE,
  BASELINE_UNAVAILABLE_NOTE,
} from '../copySetupImpactModel';
import { CATALOG, OPERATOR_ROLE_TREE } from './copySetupFixtures';

/**
 * RBAC Brick 6 — effective-access impact.
 *
 * The catalog fixture holds three actions across two capabilities:
 *   inventory.stock_transfer    view (bit 1) + approve (bit 16)   risk HIGH
 *   accounting.journal_entries  view (bit 1)                      risk LOW
 *
 * The Operator baseline grants view on both and approve on neither, so before
 * any override the target resolves 2 allowed / 1 denied. Every expectation below
 * follows from Brick 3's precedence — nothing here re-implements it.
 */

const OPERATOR_BASELINE = buildBaseline({
  roleTree: OPERATOR_ROLE_TREE,
  roleNames: ['Operator'],
  available: true,
});

const APPROVE_ALLOW = { 'inventory:stock_transfer': { allow_mask: 16, deny_mask: 0 } };
const JOURNAL_DENY = { 'accounting:journal_entries': { allow_mask: 0, deny_mask: 1 } };

const impactOf = (currentOverrides, resultOverrides, extra = {}) => buildPermissionImpact({
  catalog: CATALOG,
  baseline: OPERATOR_BASELINE,
  currentOverrides,
  resultOverrides,
  ...extra,
});

describe('33, 34. before/after totals', () => {
  it('33. counts allowed and denied on both sides', () => {
    const impact = impactOf({}, APPROVE_ALLOW);

    expect(impact.available).toBe(true);
    expect(impact.before).toMatchObject({ allowed: 2, denied: 1, totalActions: 3 });
    expect(impact.after).toMatchObject({ allowed: 3, denied: 0, totalActions: 3 });
    expect(impact.delta).toMatchObject({ allowed: 1, denied: -1 });
  });

  it('34. explains a default deny by naming the override that lifts it', () => {
    const [change] = impactOf({}, APPROVE_ALLOW).changes;
    expect(change.override.before_label).toBe('Inherit');
    expect(change.override.after_label).toBe('Allow');
    expect(change.effective.before).toBe('Denied');
    expect(change.effective.after).toBe('Allowed');
    expect(change.effective.after_source_text).toMatch(/user/i);
  });

  it('reports no change when the override sets are identical', () => {
    const impact = impactOf(APPROVE_ALLOW, APPROVE_ALLOW);
    expect(impact.changes).toEqual([]);
    expect(impact.delta).toMatchObject({ allowed: 0, denied: 0 });
  });
});

describe('31, 32. high-risk detection', () => {
  it('31. flags a newly allowed HIGH capability', () => {
    const impact = impactOf({}, APPROVE_ALLOW);

    expect(impact.highRisk).toHaveLength(1);
    expect(impact.highRisk[0]).toMatchObject({
      capability_label: 'Stock Transfer',
      risk_level: 'HIGH',
      direction: DIRECTION.GRANTED,
    });
    expect(impact.granted).toHaveLength(1);
  });

  it('32. reports a high-risk decrease separately, and never as a new grant', () => {
    const impact = impactOf(APPROVE_ALLOW, {});

    expect(impact.highRisk).toEqual([]);
    expect(impact.highRiskRevoked).toHaveLength(1);
    expect(impact.revoked[0].direction).toBe(DIRECTION.REVOKED);
    expect(impact.delta).toMatchObject({ allowed: -1, denied: 1 });
  });

  it('does not flag a LOW capability that is newly denied', () => {
    const impact = impactOf({}, JOURNAL_DENY);
    expect(impact.highRisk).toEqual([]);
    expect(impact.highRiskRevoked).toEqual([]);
    expect(impact.revoked).toHaveLength(1);
  });

  it('does not flag a high-risk action that was already allowed', () => {
    const impact = impactOf(APPROVE_ALLOW, {
      'inventory:stock_transfer': { allow_mask: 16, deny_mask: 0 },
      'accounting:journal_entries': { allow_mask: 1, deny_mask: 0 },
    });
    expect(impact.highRisk).toEqual([]);
  });
});

describe('15. Super Admin target', () => {
  it('stores the rows but changes no result', () => {
    const impact = impactOf({}, JOURNAL_DENY, { isSuperAdmin: true });

    expect(impact.before.allowed).toBe(3);
    expect(impact.after.allowed).toBe(3);
    expect(impact.delta).toMatchObject({ allowed: 0, denied: 0 });
    // The deny is stored — the override state moves — but the bypass decides first.
    expect(impact.storedOnlyChanges).toHaveLength(1);
    expect(impact.storedOnlyChanges[0].override.after_label).toBe('Deny');
    expect(impact.highRisk).toEqual([]);
  });
});

describe('degradation', () => {
  it('states the catalog outage instead of inventing totals', () => {
    const impact = buildPermissionImpact({
      catalog: null, catalogFailed: true, baseline: OPERATOR_BASELINE,
    });
    expect(impact.available).toBe(false);
    expect(impact.reason).toBe(IMPACT_UNAVAILABLE_NOTE);
    expect(impact.highRisk).toEqual([]);
  });

  it('states a baseline outage rather than reporting an unearned Denied', () => {
    const impact = buildPermissionImpact({
      catalog: CATALOG,
      baseline: buildBaseline({ roleTree: null, roleNames: [], available: false }),
      currentOverrides: {},
      resultOverrides: APPROVE_ALLOW,
    });
    expect(impact.available).toBe(false);
    expect(impact.reason).toBe(BASELINE_UNAVAILABLE_NOTE);
  });
});

describe('purity', () => {
  it('does not mutate either override map', () => {
    const current = { 'accounting:journal_entries': { allow_mask: 1, deny_mask: 0 } };
    const result = { ...APPROVE_ALLOW };
    const before = [JSON.stringify(current), JSON.stringify(result)];

    impactOf(current, result);
    expect([JSON.stringify(current), JSON.stringify(result)]).toEqual(before);
  });

  it('returns the same result for identical inputs', () => {
    const a = impactOf({}, APPROVE_ALLOW);
    const b = impactOf({}, APPROVE_ALLOW);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
