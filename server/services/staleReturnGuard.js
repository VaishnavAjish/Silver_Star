// ============================================================================
// Stale-completion return guard — pure predicates (no DB, no side effects).
//
// The retired Control Tower "Complete Process" path could complete a
// machine_process and release the machine WITHOUT closing its Process Issue,
// leaving an OPEN, seemingly-returnable issue against an already-completed
// process. Returning against it again would post a DUPLICATE physical output.
//
// These predicates are the single source of truth for:
//   * blocking a second Return on a completed/cancelled process
//     (Return workspace entry guard: validate + POST /return);
//   * classifying such issues as reconciliation candidates in the queue.
// ============================================================================

const TERMINAL_MACHINE_PROCESS_STATUSES = Object.freeze(['completed', 'cancelled']);

/**
 * A machine_process in a terminal state can no longer accept a Return.
 * @param {string|null|undefined} status
 * @returns {boolean}
 */
function isMachineProcessTerminal(status) {
  return TERMINAL_MACHINE_PROCESS_STATUSES.includes(status);
}

/**
 * A stale legacy-completion inconsistency: the issue is still OPEN with
 * remaining quantity, but its linked machine_process is already terminal.
 * Such an issue is NOT normally returnable — it is a reconciliation candidate.
 * @param {{ issueStatus: string, remaining: number|null, issuedQty: number, machineProcessStatus: string|null }} p
 * @returns {boolean}
 */
function isReconciliationCandidate({ issueStatus, remaining, issuedQty, machineProcessStatus }) {
  const rem = remaining == null ? Number(issuedQty) : Number(remaining);
  return (
    issueStatus === 'OPEN' &&
    Number.isFinite(rem) && rem > 0.0001 &&
    isMachineProcessTerminal(machineProcessStatus)
  );
}

const STALE_COMPLETION_MESSAGE =
  'This process has already been completed and cannot be returned again. ' +
  'The connected Process Issue requires reconciliation.';

module.exports = {
  TERMINAL_MACHINE_PROCESS_STATUSES,
  isMachineProcessTerminal,
  isReconciliationCandidate,
  STALE_COMPLETION_MESSAGE,
};
