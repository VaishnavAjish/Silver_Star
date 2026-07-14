/**
 * Return-identity routing — pure decision helpers for the Unified Return
 * Engine (routes/lotProcessIssues.js). No I/O, no DB, no side effects —
 * extracted for unit tests, same pattern as lotDimensions.js.
 */

const EPS = 0.0001;

/**
 * Phase 1 growth-identity rule, decided ONCE per return from backend-calculated
 * quantities:
 *
 *   BISCUIT — the return references the EXISTING Growth biscuit (no child lot,
 *             no nextReturnLotCode). Requires ALL of:
 *               · GROWTH-group issue
 *               · NOT component mode (seed_remove never intercepted)
 *               · existing biscuit row
 *               · exactly ONE return line
 *               · that line is the usable output configured to growth_run
 *               · its qty equals the full outstanding quantity (±0.0001)
 *               · nothing remains in process afterwards
 *
 *   REJECT  — a usable growth output is present but the return is partial or
 *             mixed (usable + damaged/consumed/QC). Not approved in Phase 1.
 *
 *   CHILD   — untouched legacy behaviour: damaged/consumed-only returns,
 *             non-growth processes, component mode, or no biscuit found.
 *
 * @param {{ isGrowthGroupIssue: boolean, isComponentMode: boolean,
 *           biscuit: object|null, lines: Array<{type: string, qty: any}>,
 *           allowedOutputs: Array<object>, currentRemaining: number,
 *           remainingAfter: number }} ctx
 * @returns {{ route: 'BISCUIT'|'REJECT'|'CHILD', reason?: string }}
 */
function resolveGrowthReturnRoute({
  isGrowthGroupIssue, isComponentMode, biscuit,
  lines, allowedOutputs, currentRemaining, remainingAfter,
}) {
  if (!isGrowthGroupIssue || isComponentMode) return { route: 'CHILD' };

  const usableGrowthLines = (lines || []).filter(l => {
    const rule = (allowedOutputs || []).find(o => o.type === l.type);
    return !!(rule && rule.type === 'usable' && rule.item_category_override === 'growth_run');
  });
  if (usableGrowthLines.length === 0) return { route: 'CHILD' };

  // A GROWTH usable output without its biscuit is a data-integrity error —
  // the engine must never manufacture a replacement growth identity.
  if (!biscuit) {
    return {
      route: 'REJECT',
      reason:
        'Growth biscuit or Growth Number was not found for this process. ' +
        'Return cannot be completed without the permanent Growth identity.',
    };
  }

  const isSingleUsableLine = lines.length === 1 && usableGrowthLines.length === 1;
  const usableQty     = parseFloat(usableGrowthLines[0].qty || 0);
  const isFullQty     = Math.abs(usableQty - currentRemaining) <= EPS;
  const nothingRemains = remainingAfter <= EPS;

  if (isSingleUsableLine && isFullQty && nothingRemains) return { route: 'BISCUIT' };

  return {
    route: 'REJECT',
    reason:
      'Phase 1: a Growth Return with a usable output must return the FULL outstanding ' +
      'quantity as a single usable line. Partial and mixed (usable + damaged/consumed/QC) ' +
      'growth returns are not supported yet.',
  };
}

/**
 * Row-state eligibility for reversing a full usable Growth Return (phase60).
 * Pure — SQL existence checks (later issues/movements/op-log) live in the
 * endpoint. Returns a human-readable block reason, or null when eligible.
 *
 * @param {{ header: object|null, pre: object|null, issue: object|null,
 *           biscuit: object|null, machineProcess: object|null }} ctx
 * @returns {string|null}
 */
function reversalBlockReason({ header, pre, issue, biscuit, machineProcess }) {
  if (!header) return 'Return not found.';
  if ((header.status || 'ACTIVE') === 'REVERSED')
    return 'This Growth Return has already been reversed.';
  if (!pre || pre.route !== 'BISCUIT' || !pre.biscuit || !pre.process_lot)
    return 'Only the full usable Growth Return can be reversed.';
  if (!header.is_final) return 'Only a final return can be reversed.';
  if (!issue || issue.status !== 'RETURNED')
    return 'The process issue state changed since this return — cannot reverse.';
  if (!biscuit) return 'Growth biscuit not found.';
  if (biscuit.lot_number !== pre.biscuit.lot_number)
    return 'Growth Number changed since the return — cannot reverse.';
  if (parseInt(biscuit.run_no) !== parseInt(pre.biscuit.run_no))
    return 'Growth Again has already started (run number advanced) — cannot reverse.';
  if (biscuit.machine_process_id !== pre.biscuit.machine_process_id)
    return 'The biscuit was issued to another process — cannot reverse.';
  if (biscuit.status !== 'IN STOCK')
    return `The biscuit is ${biscuit.status} — downstream activity exists.`;
  if (machineProcess && machineProcess.status === 'completed')
    return 'The machine process already completed — cannot reverse.';
  return null;
}

module.exports = { resolveGrowthReturnRoute, reversalBlockReason };
