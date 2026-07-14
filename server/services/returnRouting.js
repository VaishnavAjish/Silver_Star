/**
 * Return-identity routing — pure decision helpers for the Unified Return
 * Engine (routes/lotProcessIssues.js). No I/O, no DB, no side effects —
 * extracted for unit tests, same pattern as lotDimensions.js.
 *
 * buildReturnPlan() is the single authoritative resolver shared by the
 * read-only preflight endpoint (POST /:id/return/validate) and the actual
 * locked return transaction. The transaction recomputes the plan from the
 * FOR UPDATE row images — an earlier preflight response is never trusted.
 */

const EPS = 0.0001;

const FALLBACK_OUTPUTS = [
  { type: 'usable',   label: 'Usable',   suffix: 'R', status: 'IN STOCK' },
  { type: 'damaged',  label: 'Damaged',  suffix: 'D', status: 'DAMAGED' },
  { type: 'consumed', label: 'Consumed', suffix: 'C', status: 'CONSUMED' },
];

/** Coalesce a process's configured allowed_outputs with the legacy fallback set. */
function resolveAllowedOutputs(raw) {
  return Array.isArray(raw) && raw.length > 0 ? raw : FALLBACK_OUTPUTS;
}

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
 *   REJECT  — three data/config-integrity cases, in evaluation order:
 *               1. a GROWTH usable line whose output rule does NOT map to
 *                  growth_run (configuration-integrity — the engine must never
 *                  fall back to CHILD or mint a replacement Growth identity)
 *               2. a usable growth output with no biscuit found
 *               3. a partial or mixed (usable + damaged/consumed/QC) return
 *                  containing a usable growth output — not approved in Phase 1
 *
 *   CHILD   — untouched legacy behaviour: damaged/consumed-only returns,
 *             non-growth processes, and component mode.
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

  const ruleFor = t => (allowedOutputs || []).find(o => o.type === t);
  const usableLines = (lines || []).filter(l => {
    const rule = ruleFor(l.type);
    return !!(rule && rule.type === 'usable');
  });
  if (usableLines.length === 0) return { route: 'CHILD' }; // damaged/consumed-only

  // Configuration-integrity: on a GROWTH process every usable output must map
  // to the existing Growth Run identity. A usable rule with a missing or
  // different item_category_override must never mint a replacement identity.
  const usableGrowthLines = usableLines.filter(
    l => ruleFor(l.type).item_category_override === 'growth_run'
  );
  if (usableGrowthLines.length !== usableLines.length) {
    return {
      route: 'REJECT',
      reason:
        'Growth usable-output configuration is invalid. The usable output must ' +
        'map to the existing Growth Run identity.',
    };
  }

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
 * Single authoritative return plan — validation gates + growth-identity route +
 * projected post-return state, computed from already-loaded rows. Pure: the
 * caller loads (preflight) or locks (transaction) the rows and passes them in.
 *
 * Every quantity/component/weight gate here is byte-identical to the historic
 * inline gates of POST /:id/return, so posting behaviour is unchanged.
 *
 * @param {{
 *   issue: object,            // lot_process_issues row (+process_group)
 *   processLot: object,       // inventory row of the process/source lot (+category)
 *   biscuit: object|null,     // Growth Run biscuit row for the issue's machine_process, if any
 *   allowedOutputs: Array<object>,
 *   lines: Array<{type: string, qty: any, weight?: any}>,
 *   measurements: object|undefined,
 *   openSiblingCount: number|null,      // other OPEN issues on the same machine_process
 *   biscuitCandidateCount: number|null, // ALL growth_run rows on the machine_process
 * }} ctx
 * @returns {object} plan — { valid, error?, route, ... }
 *
 * NOTE: the client's remaining_in_process is deliberately NOT an input —
 * projected remaining is always server-calculated (see QUANTITY branch).
 */
function buildReturnPlan({
  issue, processLot, biscuit, allowedOutputs,
  lines, measurements, openSiblingCount, biscuitCandidateCount,
}) {
  const invalid = error => ({ valid: false, route: 'REJECT', error });

  if (!issue) return invalid('Issue not found');
  if (issue.status !== 'OPEN')
    return invalid(`Issue ${issue.issue_number} is already ${issue.status}`);
  if (!Array.isArray(lines) || lines.length === 0)
    return invalid('At least one return line is required');
  if (!processLot) return invalid('Process/Source lot not found');

  const outputs = resolveAllowedOutputs(allowedOutputs);
  const validTypes = outputs.map(o => o.type);
  for (const line of lines) {
    if (!validTypes.includes(line.type))
      return invalid(`Invalid return type: '${line.type}'. Allowed: ${validTypes.join(', ')}`);
    if (!(parseFloat(line.qty) > 0))
      return invalid(`qty must be positive for type '${line.type}'`);
  }

  const issuedQty = parseFloat(issue.issued_qty);
  const currentRemaining = issue.remaining_in_process !== null && issue.remaining_in_process !== undefined
    ? parseFloat(issue.remaining_in_process)
    : issuedQty;

  const isGrowthRun = processLot.category === 'growth_run';
  if (isGrowthRun && lines.length > 1)
    return invalid('Growth Run returns must use a single disposition.');

  const isComponentMode = outputs.some(o => o.component);

  let returnTotal, remainingAfter;
  if (isComponentMode) {
    // The input is wholly transformed — nothing stays in process.
    remainingAfter = 0;
    returnTotal    = currentRemaining;

    const byComponent = {};
    for (const line of lines) {
      const rule = outputs.find(o => o.type === line.type);
      const comp = rule.component || 'primary';
      byComponent[comp] = (byComponent[comp] || 0) + parseFloat(line.qty);
    }

    const requiredComponents = [...new Set(
      outputs.filter(o => o.component).map(o => o.component)
    )];
    for (const comp of requiredComponents) {
      const qty = byComponent[comp] || 0;
      if (Math.abs(qty - currentRemaining) > EPS) {
        return invalid(
          `${comp} outputs total ${qty.toFixed(4)} but must equal the ` +
          `${currentRemaining.toFixed(4)} in process. Each component group is ` +
          'validated on its own and never summed with another.'
        );
      }
    }
    if (byComponent.primary != null && byComponent.primary > currentRemaining + EPS) {
      return invalid(
        `Untagged output (${byComponent.primary.toFixed(4)}) exceeds the ` +
        `${currentRemaining.toFixed(4)} in process.`
      );
    }

    const inputWeight  = parseFloat(processLot.weight || 0);
    const outputWeight = lines.reduce((s, l) => (
      s + (l.weight !== undefined && l.weight !== null && l.weight !== '' ? parseFloat(l.weight) : 0)
    ), 0);
    if (inputWeight > 0 && outputWeight > inputWeight + EPS) {
      return invalid(
        `Output weight ${outputWeight.toFixed(4)} exceeds input weight ${inputWeight.toFixed(4)} — ` +
        'a component split cannot create mass.'
      );
    }
  } else {
    returnTotal    = lines.reduce((s, l) => s + parseFloat(l.qty), 0);
    // SERVER-CALCULATED remaining — the client's remaining_in_process is
    // NEVER trusted: projected remaining is the authoritative outstanding
    // quantity minus the sum of the proposed lines (decimal-safe, EPS).
    // A falsified remaining_in_process therefore cannot force a partial
    // return onto the BISCUIT route; the gate below now only fires when
    // more is returned than is outstanding.
    remainingAfter = Math.max(0, currentRemaining - returnTotal);

    if (Math.abs(returnTotal + remainingAfter - currentRemaining) > EPS) {
      return invalid(
        `Balance mismatch: ${returnTotal.toFixed(4)} returning + ${remainingAfter.toFixed(4)} remaining ` +
        `= ${(returnTotal + remainingAfter).toFixed(4)}, but ${currentRemaining.toFixed(4)} is available`
      );
    }
  }

  const isGrowthGroupIssue =
    String(issue.process_group || (issue.process_type === 'growth' ? 'GROWTH' : 'OTHER')).toUpperCase() === 'GROWTH';

  // Growth-identity conflict: more than one biscuit candidate on the machine
  // process is a data-integrity emergency. NEVER silently pick a row (no
  // ORDER BY … LIMIT 1) — every return on the conflicted process is blocked
  // until the duplicate identity is resolved.
  const candidates = biscuitCandidateCount != null
    ? parseInt(biscuitCandidateCount)
    : (biscuit ? 1 : 0);
  if (!isGrowthRun && isGrowthGroupIssue && !isComponentMode && candidates > 1) {
    return invalid(
      'Multiple Growth biscuits were found for this process. Return cannot ' +
      'continue until the Growth identity conflict is resolved.'
    );
  }

  // Biscuit-input returns (the process lot IS the biscuit — growth again /
  // laser ops) use the dedicated in-place branch; the growth-identity route
  // must not re-evaluate (or reject) them.
  const growthRoute = isGrowthRun
    ? { route: 'CHILD' }
    : resolveGrowthReturnRoute({
        isGrowthGroupIssue, isComponentMode, biscuit,
        lines, allowedOutputs: outputs, currentRemaining, remainingAfter,
      });
  if (growthRoute.route === 'REJECT') return invalid(growthRoute.reason);

  const isFinal  = remainingAfter <= EPS;
  const siblings = openSiblingCount == null ? 0 : parseInt(openSiblingCount);
  const common   = {
    valid: true,
    is_final: isFinal,
    return_total: returnTotal,
    remaining_after: remainingAfter,
    projected_issue_status: isFinal ? 'RETURNED' : 'OPEN',
  };

  if (isGrowthRun) {
    // In-place return of the biscuit itself: it returns to the permanent
    // Growth identity, no lot is created, run_no untouched.
    const finalStatusRule = outputs.find(o => o.type === lines[0].type);
    const finalStatus = finalStatusRule ? finalStatusRule.status : 'IN STOCK';
    return {
      ...common,
      route: 'BISCUIT',
      in_place: true,
      growth_run_input: true,
      target_lot_id: processLot.id,
      target_lot_code: processLot.lot_code || processLot.lot_number,
      growth_number: processLot.lot_number,
      run_no: processLot.run_no != null ? parseInt(processLot.run_no) : null,
      will_create_new_lot: false,
      projected_inventory_status: isFinal ? finalStatus : processLot.status,
      projected_qty: processLot.qty != null ? parseFloat(processLot.qty) : null,
      projected_weight: processLot.weight != null ? parseFloat(processLot.weight) : null,
      reversal_supported: false,
    };
  }

  if (growthRoute.route === 'BISCUIT') {
    const measuredWeight = measurements && measurements.weight != null && measurements.weight !== ''
      ? parseFloat(measurements.weight)
      : (biscuit.weight != null ? parseFloat(biscuit.weight) : null);
    return {
      ...common,
      route: 'BISCUIT',
      in_place: true,
      growth_run_input: false,
      target_lot_id: biscuit.id,
      target_lot_code: biscuit.lot_code || biscuit.lot_number,
      growth_number: biscuit.lot_number,
      run_no: biscuit.run_no != null ? parseInt(biscuit.run_no) : null,
      will_create_new_lot: false,
      // advanceGrowthRunToStock runs only when NO sibling issue stays OPEN
      projected_inventory_status: siblings === 0 ? 'IN STOCK' : 'IN PROCESS',
      projected_qty: biscuit.qty != null ? parseFloat(biscuit.qty) : null,
      projected_weight: measuredWeight,
      reversal_supported: true,
    };
  }

  // CHILD — legacy child-lot behaviour (per-line codes are generated by the
  // caller with nextReturnLotCode; a pure function cannot read the sequence).
  return {
    ...common,
    route: 'CHILD',
    in_place: false,
    growth_run_input: false,
    target_lot_id: null,
    target_lot_code: null,
    growth_number: biscuit ? biscuit.lot_number : null,
    run_no: biscuit && biscuit.run_no != null ? parseInt(biscuit.run_no) : null,
    will_create_new_lot: true,
    projected_inventory_status: isFinal ? 'CONSUMED' : processLot.status,
    projected_qty: isFinal ? 0 : (processLot.qty != null ? parseFloat(processLot.qty) : null),
    projected_weight: isFinal ? 0 : (processLot.weight != null ? parseFloat(processLot.weight) : null),
    reversal_supported: false,
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

/**
 * Config-write guardrail (routes/processMaster.js): on a GROWTH-group process
 * every usable output rule MUST map to the existing Growth Run identity —
 * buildReturnPlan hard-rejects anything else at return time. Normalizing at
 * write time means an admin cannot save a configuration the engine will
 * refuse (the live 'pr-01' failure). Pure and immutable: returns new objects,
 * never mutates. COMPONENT-mode configs (seed_remove) and non-GROWTH groups
 * are returned untouched.
 *
 * @param {string|null} processGroup
 * @param {Array<object>|any} outputs  allowed_outputs as sent by the client
 * @returns {Array<object>|any}
 */
function normalizeGrowthUsableOutputs(processGroup, outputs) {
  if (String(processGroup || '').toUpperCase() !== 'GROWTH') return outputs;
  if (!Array.isArray(outputs)) return outputs;
  if (outputs.some(o => o && o.component)) return outputs; // COMPONENT mode — never touched
  return outputs.map(o =>
    o && o.type === 'usable' && o.item_category_override !== 'growth_run'
      ? { ...o, item_category_override: 'growth_run' }
      : o
  );
}

module.exports = {
  resolveAllowedOutputs,
  resolveGrowthReturnRoute,
  buildReturnPlan,
  normalizeGrowthUsableOutputs,
  reversalBlockReason,
};
