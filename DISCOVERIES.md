# Discoveries — Spec vs. Implementation Audit

**Date:** 2026-06-24
**Scope:** Full audit of the multi-company court-reservation system against
[`spec.md`](./spec.md), front-to-back (database, backend, frontend, auth,
tests), following the spec's own implementation directives
("Principios de implementacion"). All findings are logged here; the ones marked
**FIXED / ADDED** were resolved in this pass, the ones marked **LOGGED** are
flagged for a product decision.

## TL;DR

The goal described in the spec is **largely achieved**. The domain logic
(automatic court partitioning, multi-court locking, anti-fragmentation
compaction, transactional holds with rollback, availability map, CRUD admin,
auth shell) is implemented and matches the spec's data model and acceptance
criteria. The gaps were concentrated in **(1) multi-company write isolation not
being enforced on the generic CRUD routes**, **(2) test/tooling rot that made
the suite un-runnable locally**, and **(3) small presentation/cleanup issues**.
Those are now fixed and verified. The initially pending product decisions are
recorded below for context and their implemented outcomes are appended at the
end of this document.

### Verification evidence (after fixes)

| Check | Result |
| --- | --- |
| `npm run build` (frontend webpack + backend tsc) | ✅ PASS |
| `npm run test:unit` (frontend + backend) | ✅ 36 tests pass (frontend 12, backend 24) |
| New `20260624_120000_booking_locks_overlap_guard.sql` against live Postgres | ✅ executes; defensive guard confirmed (skips gracefully without the `btree_gist` privilege) |

---

## A. What is correctly implemented (goal achieved)

These were verified by reading the code against the spec; no change needed.

- **Schema** (`database/migrations/20260617_120000_court_reservations.sql`):
  every table and column in the spec's "Modelo de datos propuesto" exists with
  matching types and constraints — `companies`, `sports`, `company_sports`,
  `courts` (with normalized `layout_*` 0..1 CHECKs), `court_partition_rules`,
  `court_prices`, `company_time_blocks`, `bookings`
  (`status IN ('held','confirmed','cancelled','expired')`), `booking_locks`,
  and `auth.user_companies` (roles `owner/manager/staff/viewer`).
- **SSOT** (`shared/src/ssot/structure.ts`): exactly the 7 admin-CRUD tables are
  registered; `bookings`/`booking_locks` are correctly excluded from generic
  CRUD; the old academic tables are gone.
- **Automatic partitioning** (`backend/src/reservations.ts`
  `createCourtWithPartitions`/`createChildCourts`): recursive subcourt creation
  inside one transaction with full rollback; layout normalization rejects
  out-of-bounds / overlapping rectangles.
- **Multi-court locking** (`getAtomicCourtIds`): reserving a big court locks all
  reservable descendants; reserving a subcourt locks only itself (siblings stay
  free) — matches the spec's blocking rule.
- **Anti-fragmentation / compaction** (`findCompactionAlternatives` + the
  `compaction_blocked` status in availability): fills an already-open parent
  group before opening another; `hold` returns `409` with `alternatives`.
- **Timeblock validation** (`validateTimeBlock` → `400`) and **pricing**
  (`priceForCourt` = price_per_hour × duration/60, inherited from ancestor).
- **Expired-hold cleanup** (`expireHeldBookings`) runs before availability and
  before each hold/confirm.
- **Transactions**: `hold`, `confirm`, `cancel`, and court creation all use
  `BEGIN/COMMIT/ROLLBACK`; `confirm`/`cancel` use `SELECT ... FOR UPDATE`.
- **Anti-overlap concurrency**: `pg_advisory_xact_lock(root, day)` + overlap
  `SELECT` — this is the spec's *documented fallback* ("Si se evita la
  extension…"), so it is spec-compliant. (Hardened further below.)
- **Frontend**: CRUD admin for all 7 tables, foreign keys rendered as readable
  labels, interactive availability map drawing normalized-layout tiles with
  per-status colors, `hold` → `confirm` flow, court creation routed through
  `POST /api/companies/:id/courts`. Auth shell (login / forced password change /
  logout / role-based hiding) works; the academic UI is fully removed.

---

## B. Findings that were FIXED / ADDED in this pass

### B1 — [HIGH] Multi-company write isolation not enforced on generic CRUD — **FIXED**

- **Spec:** "Las escrituras requieren usuario autorizado para esa empresa" and
  "Usuarios asociados a una empresa solo pueden operar sobre su empresa"
  (`spec.md` §Endpoints, §Auth y multiempresa, Fase 5).
- **Evidence:** The reservation endpoints scope writes via `hasCompanyAccess`
  (`backend/src/reservations.ts`), but the generic `POST/PUT/DELETE
  /api/:tableName` handlers (`backend/src/routes/*.ts`, wired in
  `backend/src/server.ts`) only checked the **global** role
  (`requireBusinessWrite` = admin/editor). A user tied to company A could create
  / edit / delete company B's `company_sports`, `court_prices`,
  `company_time_blocks`, etc.
- **Constraint discovered:** the existing tests (`editor can create companies`,
  `duplicate company identity` logs in as **editor**) prove the intended model:
  a global `editor` is an unrestricted business writer, and `auth.user_companies`
  is an *additional* per-company layer. So strict "admin-only" enforcement would
  break the design.
- **Fix (additive, non-breaking):** new module
  [`backend/src/companyAccess.ts`](./backend/src/companyAccess.ts), wired into
  the three generic write routes in `server.ts`. Rules:
  - global **admin** → manages everything;
  - a user with **no** `auth.user_companies` link → keeps the historical
    global-business-writer behaviour (existing tests stay green);
  - a user **with** company links → may only write company-scoped resources of
    their own companies (with a write role `owner/manager/staff`); creating a
    brand-new company stays admin/global-editor only.
  - global catalogs (`sports`, `court_partition_rules`) remain governed by the
    role gate only.
- **Tests added:** `backend/test/companyAccess.test.ts` (10 unit tests on the
  pure decision + scope-resolution logic) and a new endpoint test
  `company-scoped users may only write their own company` in
  `backend/test/auth.test.ts` (cross-company write → `403`, own company → `201`).
  This directly covers the spec's "Tests de acceso cruzado entre empresas".

### B2 — [HIGH] Test suite could not run locally (dev deps missing) — **FIXED**

- **Evidence:** `vitest` was not installed in either `backend/node_modules` or
  `frontend/node_modules`; `npm test` printed `vitest: command not found`. The
  failure was masked because the root `test:unit` chains with `&&` and the
  earlier "green" results came from Docker only.
- **Fix:** installed dev dependencies (`npm --prefix backend/frontend install`).
  The suite now runs locally — 36 tests pass.

### B3 — [MEDIUM] `npm run test:db` was broken (dangling include) — **FIXED**

- **Evidence:** `backend/vitest.db.config.mts` included `test/api_tests.ts`,
  which does not exist, so the DB test command failed to start.
- **Fix:** removed the dangling include; `vitest.db.config.mts` now runs the
  existing `test/migrate.test.ts` (the real-Postgres migration test).

### B4 — [MEDIUM] Anti-overlap had no DB-level guarantee — **ADDED (defense-in-depth)**

- **Spec:** the *preferred* protection is a PostgreSQL exclusion constraint on
  `booking_locks` (`spec.md` §Guardas anti-overlap). The code used only the
  documented advisory-lock fallback, which has a thin edge case (two holds whose
  ranges cross the advisory-lock day boundary take different keys).
- **Fix:** new forward-only migration
  [`database/migrations/20260624_120000_booking_locks_overlap_guard.sql`](./database/migrations/20260624_120000_booking_locks_overlap_guard.sql)
  adds `EXCLUDE USING gist (court_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)`.
  It is wrapped in a `DO/EXCEPTION` block so that if `btree_gist` is unavailable
  (or pre-existing rows would violate it) it logs a `NOTICE` and continues
  instead of aborting start-up. Validated against the live DB: under a restricted
  role it skipped cleanly; in the docker deployment (`aida26_user` is the
  `POSTGRES_USER`/superuser) it will create the constraint.

### B5 — [MEDIUM] `unavailable` slots were visually identical to `available` — **FIXED**

- **Evidence:** `frontend/styles/style.css` had no rule for
  `[data-status="unavailable"]`, so unavailable tiles/slots rendered the same
  green (`#d8f3dc`) as available ones, while `app.ts` does set
  `data-status="unavailable"`.
- **Fix:** added a distinct muted rule for `[data-status="unavailable"]`.

### B6 — [LOW] Dead stylesheet reference + orphaned file — **FIXED**

- **Evidence:** `frontend/index.html` linked `styles/styles.css`, but the app's
  styles are bundled by webpack via `import '../styles/style.css'` in
  `src/app.ts`. The linked file was the old, unbundled stylesheet and would 404
  in the build output.
- **Fix:** removed the dead `<link>` and deleted the orphaned
  `frontend/styles/styles.css` (confirmed no source references it).

### B7 — [LOW] Thin acceptance-criteria coverage — **ADDED**

- Added reservation tests asserting the spec's sibling-isolation criteria:
  reserving a subcourt locks only itself; reserving an intermediate court locks
  only its own descendants (`backend/test/reservations.test.ts`).

---

## C. Historical decision record (superseded by the implementation update below)

These are real divergences from the spec, but changing them is a
security/product call rather than a clear bug fix, so they are documented rather
than silently altered.

### C1 — [DECISION] `POST /api/bookings/hold` requires authentication

- **Spec:** "Clientes pueden reservar sin cuenta en fase inicial, dejando datos
  de contacto en `bookings`" (`spec.md` §Auth y multiempresa).
- **Current:** the hold/confirm/cancel/availability routes are behind
  `requireAuth` (`server.ts`). The schema already supports anonymous booking
  (`bookings.created_by_user_id` is nullable).
- **Why not auto-changed:** opening an unauthenticated write endpoint is an
  outward-facing security change. **Recommendation:** if anonymous booking is in
  scope, drop `requireAuth` from `hold`/`availability` (keep company validation)
  and add rate-limiting; otherwise update the spec to mark it out of initial
  scope.

### C2 — [DECISION] Read endpoints are not company-scoped

- The generic `GET /api/:tableName` returns every company's rows to any
  authenticated user. The spec emphasizes *write* authorization; reads are not
  explicitly restricted (and clients are expected to browse availability).
- **Recommendation:** if read isolation is desired for company-scoped users,
  filter list queries by the caller's `auth.user_companies` for company-scoped
  tables (mirror `companyAccess.ts`). Left as a follow-up to keep this pass
  focused and low-risk.

### C3 — [DECISION] Strict vs. additive company model are not unified

- Reservation endpoints use **strict** scoping (`hasCompanyAccess` denies an
  unlinked non-admin), while the generic CRUD now uses an **additive** model
  (unlinked editors stay global). They agree for admins and for linked users;
  they differ for an unlinked global `editor`. Unifying them requires deciding
  whether the global `editor` role should survive in the multi-company world,
  which in turn needs a UI/seed to assign `auth.user_companies` (none exists
  yet). **Recommendation:** add company-link management (admin UI or seed) and
  then pick one model.

### C4 — [DECISION] No real-DB integration test of the reservation transaction

- Unit tests cover the pure algorithms and the auth flow with a fake DB; there
  is no end-to-end test that exercises a real hold/confirm against Postgres
  (the previously-referenced `api_tests.ts` never existed). `test:db` now runs
  again (B3), so this can be added on top of it.
- **Recommendation:** add an `api_tests.ts` under `vitest.db.config.mts` that
  spins migrations + seeds and asserts: overlapping holds → `409`, sibling
  subcourts allowed, disabled timeblock → `400`, and rollback leaves no partial
  rows.

---

## D. Files changed in this pass

- `backend/src/companyAccess.ts` — **new**, per-company CRUD authorization.
- `backend/src/server.ts` — wire `enforceCompanyScope` into generic POST/PUT/DELETE.
- `backend/vitest.config.mts` — include the new test file.
- `backend/vitest.db.config.mts` — drop the dangling `api_tests.ts` include.
- `backend/test/companyAccess.test.ts` — **new** unit tests.
- `backend/test/auth.test.ts` — FakeDb support for `auth.user_companies` + cross-company test.
- `backend/test/reservations.test.ts` — sibling-isolation assertions.
- `database/migrations/20260624_120000_booking_locks_overlap_guard.sql` — **new**, defensive overlap exclusion constraint.
- `frontend/styles/style.css` — distinct `unavailable` status color.
- `frontend/index.html` — remove dead stylesheet link.
- `frontend/styles/styles.css` — **deleted** (orphaned).

---

## E. Recommended solutions for the pending decisions (C1–C4)

These are the items intentionally left for a product decision. For each one,
this is the solution I recommend and **exactly how I would implement it**, so it
can be picked up directly.

### C1 — Allow anonymous booking (`hold` without a session)

**Recommendation:** make `availability` and `hold` public; keep `confirm` and
`cancel` (and court creation) authenticated. Add a lightweight per-IP throttle so
the public write endpoint can't be abused.

**Exactly how:**

1. `backend/src/server.ts` — drop the auth middlewares from the two public routes:
   ```ts
   app.get('/api/companies/:companyId/availability', getCompanyAvailability(pool));
   app.post('/api/bookings/hold', holdBooking(pool));
   ```
   Leave `requireAuth, requirePasswordReady` on `/api/companies/:companyId/courts`,
   `/api/bookings/:id/confirm`, `/api/bookings/:id/cancel`.
2. `backend/src/reservations.ts` — make the company check conditional on an
   authenticated user in `getCompanyAvailability` and `holdBooking`:
   ```ts
   const user = (req as AuthedRequest).user;
   if (user) await requireCompanyAccess(client, req, companyId, false);
   ```
   `holdBooking` already stores `created_by_user_id = req.user?.id ?? null`, so an
   anonymous hold is persisted with a null creator and the customer contact fields
   — no further change needed.
3. Abuse mitigation **without new prod deps:** a tiny in-memory sliding-window
   limiter keyed by `req.ip` (e.g. max 10 holds / 10 min) as a middleware on
   `/api/bookings/hold`. (If a dependency is acceptable, use `express-rate-limit`.)
   Holds already self-expire in 10 minutes, which bounds the blast radius.
4. Tests: anonymous `POST /api/bookings/hold` (no cookie) → `201` with
   `created_by_user_id = null`; `confirm` still returns `401` without a session.

**Trade-off:** opens one write endpoint publicly; mitigated by the throttle, the
10-minute hold expiry, and (later) a captcha.

### C2 — Company-scoped reads

**Recommendation:** for company-scoped *users* (those with `auth.user_companies`
links), filter list reads to their companies; admins and unlinked users keep
seeing everything (non-breaking, mirrors `companyAccess.ts`).

**Exactly how:**

1. Add a helper to `backend/src/companyAccess.ts`:
   ```ts
   export async function companyIdsForReadFilter(pool, user): Promise<number[] | null> {
     if (!user || user.role === 'admin') return null;          // no filter
     const links = await fetchUserCompanyLinks(pool, user.id);
     return links.length ? links.map((l) => l.company_id) : null; // unlinked => no filter
   }
   ```
2. Thread the result into `backend/src/routes/get.ts`. `getHandler` already
   receives `req`; pass `req.user` down to `getListOfTable` and, for
   company-scoped tables, append a forced predicate when the filter is non-null:
   - `companies` → `id = ANY($n)`
   - `courts`, `company_sports`, `company_time_blocks` → `company_id = ANY($n)`
   - `court_prices` → `court_id IN (SELECT id FROM courts WHERE company_id = ANY($n))`
   The cleanest place is an optional `forcedPredicate` parameter in
   `buildListQuery` so the existing filter logic is untouched.
3. Tests: a linked user `GET /api/company_time_blocks` returns only their
   company's rows; an admin/unlinked user still gets all.

**Caveat:** this touches the generic query builder, so it is the most invasive of
the four; keeping it gated to linked users keeps it non-breaking.

### C3 — Unify the strict vs. additive permission model

**Recommendation:** adopt the additive model everywhere, and add a real way to
assign `auth.user_companies` links (today there is none, which is why the two
models could diverge).

**Exactly how:**

1. New admin endpoints in `backend/src/server.ts`, behind `requireAdmin`:
   - `POST /api/admin/users/:id/companies` body `{ company_id, role }` →
     `INSERT ... ON CONFLICT (user_id, company_id) DO UPDATE SET role = ...` on
     `auth.user_companies`.
   - `DELETE /api/admin/users/:id/companies/:companyId` → remove the link.
2. A small "Usuarios y permisos" panel in `frontend/src/app.ts` reusing the
   existing table+form pattern to list users and assign company + role.
3. Once links can be assigned, align reservations' `hasCompanyAccess`
   (`backend/src/reservations.ts`) with the additive semantics of
   `companyAccess.ts` (an unlinked global `editor` is allowed) — or consciously
   keep it strict and require links — but document the single chosen rule.
4. Tests for the new endpoints + a cross-layer test asserting the same user is
   treated identically by the reservation routes and the generic CRUD routes.

### C4 — Real-DB integration test of the reservation transaction

**Recommendation:** add `backend/test/api_tests.ts`, run by
`vitest.db.config.mts` against the dockerized Postgres (the dangling reference
that broke `test:db` is already removed — B3).

**Exactly how:**

1. Use the existing `backend/test/helpers.ts` (`makeTestPool`, `resetTestDb`,
   `runMigrations`) to reset the DB, apply migrations, then seed: a company, a
   sport, the `company_sports` link, a partitionable `soccer_11` court (via
   `createCourtWithPartitions`), a `company_time_blocks` row, and a
   `court_prices` row.
2. Boot `app` against the real pool (same harness style as `auth.test.ts`) and
   assert the spec's acceptance criteria end-to-end:
   - two overlapping holds on the same court → second returns **409**;
   - two holds on compatible sibling subcourts → both **201**;
   - hold with a non-enabled `duration_minutes` → **400**;
   - `price_total` == `price_per_hour` × `duration / 60`;
   - after forcing a mid-hold error, **no** `bookings` / `booking_locks` rows
     remain (rollback is clean).
3. Run locally with `docker compose up -d database` then
   `npm --prefix backend run test:db`; wire the same into CI.

---

## F. Implemented decision outcomes — 2026-06-24

### F1 — Strict access by company

- The global `admin` manages every company and global catalog.
- Every non-admin needs an explicit `auth.user_companies` relation. Without a
  relation, they cannot read or mutate company-scoped data.
- `owner`, `manager`, and `staff` are operational roles; `viewer` is read-only.
  Global catalogs (`sports`, `court_partition_rules`) remain admin-managed.
- The generic reader filters `companies`, `company_sports`,
  `company_time_blocks`, `courts`, and `court_prices` by the user's linked
  companies. The public availability flow is separate and intentionally stays
  publicly readable.

### F2 — Public availability and anonymous holds

- `GET /api/public/companies`, `GET /api/public/companies/:companyId/sports`,
  and `GET /api/public/companies/:companyId/time-blocks` expose only active
  booking choices.
- `GET /api/companies/:companyId/availability` and `POST /api/bookings/hold`
  do not require a session. Anonymous holds persist with
  `created_by_user_id = NULL` and retain the existing 10-minute expiry.
- A dependency-free, in-memory sliding window limits public holds to 10 per IP
  every 10 minutes. It is per backend process; a multi-replica deployment must
  move this control to a shared store or the edge.
- Confirming and cancelling remain authenticated operations and additionally
  require an operational role for the booking's company.

### F3 — User-company role administration

- New admin-only routes (also requiring an active session and a changed
  password):
  - `GET /api/admin/users`
  - `GET /api/admin/users/:id/companies`
  - `POST /api/admin/users/:id/companies` with `{ company_id, role }`
  - `DELETE /api/admin/users/:id/companies/:companyId`
- The **Permisos** screen reuses the existing shell and lets an admin assign,
  update, inspect, and remove `owner`, `manager`, `staff`, and `viewer` links.
- IDs and roles are validated before persistence; successful changes are
  audited without recording credentials, session material, salts, or hashes.

### F4 — Public booking screen and local auth documentation

- The login screen now includes the public booking map. Its selectors follow
  the company → sport → duration dependency. An anonymous visitor receives a
  clear pending-confirmation message after a successful hold and never receives
  confirmation controls.
- The signed-in availability view uses the same underlying controls; the
  backend remains the final authorization authority for confirmation/cancel.
- `auth.md` is retained as local documentation and ignored by Git, so it no
  longer participates in the shared change set.
