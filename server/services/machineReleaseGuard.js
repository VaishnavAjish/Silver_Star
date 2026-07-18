// ============================================================================
// Machine release guard — pure predicates (no DB, no side effects).
//
// A FULL Return must complete the linked machine_process and release the
// machine inside the same transaction — or roll everything back. The SSD-100
// defect class ("inventory IN STOCK + machine still RUNNING + no active
// process") is only possible when the release is skipped or mis-targeted, so
// these assertions run BEFORE the completion writes and any violation aborts
// the whole Return.
// ============================================================================

const ACTIVE_MACHINE_PROCESS_STATUSES = Object.freeze(['running', 'hold']);

/**
 * Assess whether the machine lifecycle may be completed for a final Return.
 * @param {{
 *   issueMachineId: number|string|null|undefined,
 *   machineProcess: { machine_id: number|string, status: string }|null|undefined,
 *   activeProcessCount: number
 * }} p
 * @returns {{ ok: boolean, reason: string|null }}
 */
function assessMachineRelease({ issueMachineId, machineProcess, activeProcessCount }) {
  const blocked = reason => ({ ok: false, reason: `Final Return blocked: ${reason} — rolling back; reconcile the machine state first.` });

  if (!machineProcess) {
    return blocked('the linked machine process was not found');
  }
  if (!ACTIVE_MACHINE_PROCESS_STATUSES.includes(machineProcess.status)) {
    return blocked(`the linked machine process is '${machineProcess.status}', not active`);
  }
  if (issueMachineId !== null && issueMachineId !== undefined
      && Number(machineProcess.machine_id) !== Number(issueMachineId)) {
    return blocked('the linked machine process belongs to a different machine than this Issue');
  }
  if (Number(activeProcessCount) !== 1) {
    return blocked(`expected exactly one active process on the machine, found ${activeProcessCount}`);
  }
  return { ok: true, reason: null };
}

module.exports = { ACTIVE_MACHINE_PROCESS_STATUSES, assessMachineRelease };
