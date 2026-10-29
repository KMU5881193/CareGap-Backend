# Persistence readiness audit (Wave A/B + Phase 2)

**Status:** draft schemas + PostgreSQL repository code exist; **not** applied to shared/ops DBs.
**Live DB verification:** blocked — no `DATABASE_URL` for isolated `caregap_local` in this workspace; team containers exist but must not be mutated by agents.

## Existing applied schema (repository)

| Artifact | State |
|---|---|
| `migrations/0001_be1_create_users_table.sql` | Present under `migrations/` (immutable checksum once applied) |
| `users` | Only applied-candidate business table in runner path |
| `persons`, bindings, assignments, family | **Absent** (BE1-owned; not finalized here) |
| `appointments` … `notifications` | Absent until draft `0002` promoted |
| Phase 2 delivery tables | Absent until draft `0005` promoted |

## Draft dependency order (do not apply without review)

1. `0001` users (already in runner directory)
2. `0002_be2_consultations.sql` — appointments, consultations, versions, follow_ups, **notifications** (from `feature/be2-db-schema` / PR #22 reference; copied to drafts only)
3. `0003_be2_appointment_consultation_type.sql` — nullable `consultation_type` (Wave A; no status ENUM)
4. `0004_be1_person_account_bindings.sql` — **BLOCKED** placeholder (BE1 must own)
5. `0005_be2_notification_phase2.sql` — devices, preferences, outbox + additive notification columns

`scripts/migrate.ts` only reads `migrations/*.sql` (not `drafts/`), loopback `caregap_local` only.

## Repository implementation matrix

| Port | Memory | PostgreSQL | Production mount |
|---|---|---|---|
| AppointmentSnapshotRepository | InMemory / Unavailable | `PgAppointmentSnapshotRepository` | fail-closed until 0002 |
| PersonAccountBindingStore | InMemory / Blocked | **not invented** | BLOCKED on BE1 |
| AuthorizationPort / relations | InMemory / Blocked | **not invented** | BLOCKED on BE1 |
| InAppNotificationStore | Memory | `PgInAppNotificationStore` | createApp stays memory |
| Outbox | Memory | `PgNotificationOutboxRepository` (SKIP LOCKED) | not mounted |
| Devices / Preferences | Memory | Pg* | not mounted |

## Worker readiness

- `createNotificationWorkerLifecycle`: explicit `enabled` opt-in
- Default `FCM_ENABLED=false`
- Mock forbidden when FCM enabled
- `createApp` does **not** start workers
- Claim recovery via expired `claim_expires_at` + SKIP LOCKED (SQL) / mutex (memory)

## Safety

- No checksum edits to applied `0001`
- No shared DB migrate/reset
- No Firebase live send from app bootstrap
- PR #23 synthetic server preserved
- PR #22 not cherry-picked wholesale (SQL draft + patterns only)
