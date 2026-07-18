# Control Tower Single Completion Engine — Production Runbook

Guarded execution order for EC2. **Nothing in this file has been executed.**
Every step is owner-approved, run manually, one at a time. Steps 3–5 change
data and require the read-only reports from step 2 to be reviewed first.

## 1. Runtime truth (read-only)

```bash
pm2 jlist   # confirm pm_cwd + script of the API process
git -C <pm2_cwd> rev-parse --abbrev-ref HEAD && git -C <pm2_cwd> rev-parse HEAD
git -C <pm2_cwd> merge-base --is-ancestor <this-work's-SHA> HEAD && echo DEPLOYED || echo NOT-DEPLOYED
grep -c "Record Return" <pm2_cwd>/server/public/assets/ManufacturingDashboardPage-*.js  # 0 = stale client build
```

Deploy this branch (git pull + `npm run build` + `pm2 restart`) before any data
step — the code must stop writing `awaiting_output` before data is reconciled.

## 2. Read-only diagnostics (no changes; both end in ROLLBACK)

```bash
node server/run-inspection.js server/sql/completion-mode-report.sql
node server/run-inspection.js server/sql/control-tower-state-classification.sql
```

Review: `ACTIVE_OUTPUT_BASED`, `LIVE_OUTPUT_BASED_PROCESSES`, `PR01_DOCTRINE`,
`STALE_AWAITING_OUTPUT_CANDIDATES`, `COMPLETED_PROCESS_OPEN_ISSUE`,
`AMBIGUOUS_*` rows.

## 3. Configuration (guarded, idempotent, owner-approved)

```bash
psql -U postgres -d silverstar_grow -f server/migrations/phase65-pr01-completion-mode.sql
```

Sets pr-01 → RETURN_BASED. Safe post-code-deploy: the app.js boot reset that
previously reverted this on every PM2 restart is removed. Re-run the
completion-mode report; `PR01_DOCTRINE` must read `OK`.

## 4. Stale machine reconciliation (guarded, owner-approved)

Only after step 2 shows `STALE_AWAITING_OUTPUT_CANDIDATES` and per-machine
review:

```bash
psql -U postgres -d silverstar_grow -f server/migrations/phase66-reconcile-stranded-pr01.sql
```

For any remaining `STALE_AWAITING_OUTPUT` machines not covered by phase66, use
a single guarded UPDATE per machine (guard: **zero** active machine_processes
at UPDATE time) plus a `machine_status_logs` row — never a bulk unguarded
UPDATE. `COMPLETED_PROCESS_OPEN_ISSUE` rows go through the existing SSD-056
reconciliation (`phase69-ssd056-legacy-completion-reconciliation.sql`), not
through Returns.

## 5. Restart regression + acceptance

```bash
pm2 restart <api-app>
node server/run-inspection.js server/sql/completion-mode-report.sql   # PR01_DOCTRINE still OK
```

Then run the controlled end-to-end acceptance: start process → partial Return
(machine stays RUNNING) → full Return (issue RETURNED, machine AVAILABLE,
Last Completed Run populated) → refresh + PM2 restart preserve all results.

## Explicitly NOT in scope

- phase70 / Growth-Again reconciliation (separate owner approval).
- Dropping the `awaiting_output` enum value (historical logs stay readable).
- Any bulk UPDATE without the per-step guards above.
