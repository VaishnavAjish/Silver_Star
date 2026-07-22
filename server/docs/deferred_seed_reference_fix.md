# Deferred Note: Permanent Architecture Correction for Seed Reference Weight Resolution

## 1. Why Seed Reference Resolved to Zero
During the Seed Attachment / Growth Run process, the seed inventory item's `manufacturing_state` is updated to `ATTACHED_TO_GROWTH` and its `status` to `IN PROCESS`. In legacy/earlier workflows, the seed's `weight` column in `inventory` was either initialized to `0.0000` or cleared upon embedding into the growth assembly without storing an explicit snapshot of the initial seed reference weight on the process issue or growth run cycle record.

When `returnRouting.js` calculates `attachedSeed.refWeight`:
```javascript
const seedRefWeight = attachedSeed.refWeight != null ? parseFloat(attachedSeed.refWeight) : null;
```
It sums `s.weight` across all attached seed inventory records (`WHERE manufacturing_state = 'ATTACHED_TO_GROWTH'`). Since `s.weight` was `0.0000`, `attachedSeed.refWeight` resolved to `0.0000`, causing the validation gate `seedOutWeight > seedRefWeight + EPS` to reject the Seed Remove return.

## 2. Missing Canonical Snapshot
The `lot_process_issues` table and `growth_run_cycles` table lacked an explicit `seed_ref_weight` or `initial_seed_weight` snapshot column captured at the time the seed was issued or attached to the growth run.

## 3. Affected Code Path
- `server/routes/lotProcessIssues.js`: lines 1471-1505 (resolution of `attachedSeedCtx.refWeight`).
- `server/services/returnRouting.js`: lines 378-385 (`seedRefWeight` gate).

## 4. Recommended Permanent Fix
1. Add a `seed_reference_weight` NUMERIC column to `lot_process_issues` (or `growth_run_cycles`).
2. Populate `seed_reference_weight` at the time of Seed Issue / Growth Run creation from the seed lot's physical weight.
3. Update `attachedSeedCtx` resolution in `lotProcessIssues.js` to fallback to `gi.seed_reference_weight` or `grc.seed_reference_weight` if `s.weight` is 0.

## 5. Regression Tests Needed
- `tests/growthReturnRouting.test.js`: Add test for Seed Remove return when attached seed row has weight 0 but issue snapshot has reference weight.
- `tests/seedLifecycle.test.js`: Test seed attachment, growth run cycle creation, and seed remove return sequence under snapshot fallback.
