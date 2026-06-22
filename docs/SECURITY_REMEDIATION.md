# Security Remediation — Hand-off Note

> For a **fresh session with the server runnable**. Each fix is applied **then smoke-tested** before the next. Do not batch — these touch app-wide/auth-critical paths.

## Context
Internal factory ERP. **Access model: data is scoped per user/department** (confirmed by owner). So row-level isolation is mandatory, not optional.

## Already fixed (do NOT redo)
- ✅ `authorize('admin','operator')` added to `POST /api/vendor-advances/apply` (`routes/vendorAdvances.js`)
- ✅ `pageSize`/`limit` capped at 10,000 in the global GET pagination middleware (`app.js`)
- ✅ `vendorAdvances.js` GET handlers: log server-side + return generic `"Internal error"` (no `err.message` leak); `/apply` keeps its 400 validation messages
- ✅ `rls.js` fail-open path now logs at `error` level with a `SECURITY`/`TODO` marker (behavior still fail-open)

## Reporting integration already done (context)
- `vendors.js` (`/:id`, `/summary`, list) + `reports.js` AP aging read authoritative `purchase_notes.amount_paid`; `/:id` reuses `vendorAdvanceService.getVendorPosition()`.

---

## STEP 1 — Decide everything: do RLS policies exist? (read-only, zero risk)
```sql
SELECT schemaname, tablename, policyname, cmd, qual
FROM pg_policies
ORDER BY tablename, policyname;

-- Also confirm RLS is enabled per table:
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace
ORDER BY relname;
```
**Decision tree:**
- **No policies / `relrowsecurity = false`** → 🔴 CRITICAL live hole: every user sees all data. RLS must be designed + added (policies referencing `current_setting('app.current_user_id')` / `app.current_user_department_id` set in `middleware/rls.js`). This is the biggest item.
- **Policies exist** → isolation is enforced at the DB; the remaining gap is app-code `:id` IDOR (Step 5) + the fail-open path (Step 2).

---

## STEP 2 — RLS fail-closed + move reads out of the write transaction
**Read first:** `db/pool.js` (how `rlsContext` / `req.db` is consumed by `pool.query`), `middleware/rls.js`.
**Risk:** HIGHEST blast radius — wraps every authenticated route. Fail-closed when policies are absent → every request 500s.
**Changes:**
1. Only flip `rls.js` to fail-closed (`return res.status(500)`) **after** Step 1 confirms policies exist.
2. For read-only (GET) requests, set RLS GUCs with `SET LOCAL` inside a transaction that is **committed/rolled back promptly**, or use a non-transaction `SET` on the pinned client, so a slow response doesn't hold an open transaction + pooled connection (pool-exhaustion DoS).
**Test:** restart → `GET /api/health` → log in → open Dashboard, Vendors, Purchase, Reports → confirm data + no 500s; load-test a heavy report while watching pool size.

---

## STEP 3 — JWT short TTL + Redis revocation + logout
**Read first:** `config/security.js` (token signing/TTL), the login + refresh routes in `routes/auth.js`, the `ioredis` client wiring.
**Risk:** `authenticate()` runs on every request — a misfiring blocklist check locks out all users.
**Changes:** access TTL 5–15 min; refresh rotation; Redis blocklist (`jti` → revoked) checked in `authenticate()`; `POST /api/auth/logout` adds the token's `jti` to the blocklist with TTL = remaining token life. Fail-open the blocklist check (if Redis is down, don't lock everyone out — log instead).
**Test:** login → call a protected route → logout → confirm same token now 401s → confirm refresh issues a new token.

---

## STEP 4 — Redis-backed rate limiter
**Read first:** how `ioredis` is configured (`REDIS_URL`).
**Install:** `npm i rate-limit-redis` (server/).
**Risk:** misconfigured store throws on every request → API-wide 500s; new dependency.
**Change:** give `authLimiter` + `globalLimiter` a shared Redis store so PM2 cluster workers share counters; stop `skipSuccessfulRequests` on the auth limiter (credential-stuffing).
**Test:** hammer `/api/auth/login` past the limit from one IP → confirm 429 across workers.

---

## STEP 5 — IDOR enforcement on `:id` endpoints
**Prereq:** the scoping rule from Step 1 (which column links a record to a user/department — verify `vendors`/`purchase_notes`/etc. actually have `department_id` or equivalent).
**Risk:** wrong rule → 403 on pages users should see (broken pages).
**Change:** prefer DB RLS (Step 1/2) as the enforcement layer so app code doesn't need per-route ownership checks. If RLS can't cover a route, add an explicit ownership/department check on `:id` reads (`vendors/:id`, `purchase/:id`, `vendor-advances/position|available/:vendorId`, etc.).
**Test:** as a scoped user, request another department's record id → expect 403/empty.

---

## STEP 6 — Global error-message sanitization
**Read first:** `middleware/errorHandler.js` (it may already sanitize — don't double-handle).
**Change:** centralize: route `catch` blocks → `next(err)`; `errorHandler` returns generic message + correlation id to client, logs full detail server-side. Keep intentional 400 validation messages.
**Test:** trigger a DB error → confirm client sees generic message, server log has detail + correlation id.

---

## Suggested order
1 → 2 → 5 (isolation), then 3 (token theft), 4 (abuse), 6 (info leak).

## Files to open in the fresh session
`db/pool.js`, `middleware/rls.js`, `middleware/auth.js`, `config/security.js`, `routes/auth.js`, `middleware/errorHandler.js`, `app.js`, and the schema/migrations for any `CREATE POLICY` / `ENABLE ROW LEVEL SECURITY`.
