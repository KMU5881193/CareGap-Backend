# Wave B — Migration / schema compatibility audit

**Status:** review draft only. Do **not** apply to shared or production databases.
**Date context:** branch `feature/caregap-waveb-integration` vs upstream/main + Wave A `0b9fe36`.

## Verified repository facts

| Item | Fact |
|---|---|
| Prisma | **No** `schema.prisma` or Prisma client in this repository |
| Applied migrations runner input | `migrations/*.sql` only (`pnpm migrate`) |
| Present applied candidate | `migrations/0001_be1_create_users_table.sql` |
| Wave A draft | `migrations/drafts/0003_be2_appointment_consultation_type.sql` (not applied) |
| Referenced but **missing** | `migrations/drafts/0002_be2_consultations.sql` (docs cite it; file absent here) |
| notifications | Do **not** recreate; Phase 2 outbox/devices are separate |

## 0001 `users` vs BE1 verbal Prisma contract

| Topic | 0001 SQL (repo) | BE1 verbal / legacy code | Conflict |
|---|---|---|---|
| Role values | CHECK `'patient','family','staff','admin'` (lowercase) | Wire/examples often `PATIENT`/`FAMILY`/`STAFF`/`ADMIN`; `auth.service.ts` uppercase | **Casing conflict** — Wave B auth adapter normalizes both → Actor lowercase |
| Status | `PENDING` / `APPROVED` / `REJECTED` | Legacy memory auth also uses `ACTIVE` for non-staff | **ACTIVE not in SQL** — adapter accepts only APPROVED |
| PK | `user_id UUID` | Supabase Auth `user.id` expected to match | Assumes 1:1; not proven by Prisma model |
| person mapping | **none** | BE1 owns person↔user | **BLOCKED** — no table/model in repo |
| PatientRelation approval | memory link without status | APPROVED relations only | **BLOCKED** — no `family_links` / `staff_assignments` SQL |

## Wave A 0003 draft

- Adds nullable `appointments.consultation_type text`
- Depends on an `appointments` table from 0002, which is **not present** in this tree
- Must not move to `migrations/` until 0002 is accepted, nullability/backfill decided, and BE2 owners approve
- Call Eligibility already DENYs when `consultation_type` is missing

## Current DB role casing

Cannot be confirmed against a live shared DB from this workspace (shared/ops migration forbidden).
Code contracts:

- Shared `Actor.role`: lowercase enum
- SQL CHECK: lowercase
- Adapter: accepts UPPER or lower; rejects unknown

## Prisma vs pg

There is **no Prisma implementation to collide with**. Assuming Prisma models exist would be incorrect.
Wave B uses ports + fail-closed / in-memory test doubles until BE1 lands persistence.

## Provisional draft (not for apply)

See `migrations/drafts/0004_be1_person_account_bindings.sql` — design sketch only.

## Phase 2 draft number collision (resolved on integration)

| Draft | Source |
|---|---|
| `0003_be2_appointment_consultation_type.sql` | Wave A (kept) |
| `0003_be2_notification_phase2.sql` | Phase 2 original — **renumbered to `0005_be2_notification_phase2.sql`** |
| `0004_be1_person_account_bindings.sql` | Wave B |
| `0005_be2_notification_phase2.sql` | Phase 2 after merge |

None of these drafts are applied by `pnpm migrate`.
