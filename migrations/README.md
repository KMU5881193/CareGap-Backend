SQL migrations: NNNN_beN_description.sql. Applied files are immutable. Common schema requires BE1 and affected domain review. No business schema is pre-created. Runner permits only loopback caregap_local.

Draft SQL (not applied by the runner) may live under `migrations/drafts/`.

## Applied path

| File | Owner | Notes |
|---|---|---|
| `0001_be1_create_users_table.sql` | BE1 | `users` only. Do not edit after apply (checksum). |

## Draft order (review only — do not apply to shared/production)

| Draft | Origin | Creates / alters |
|---|---|---|
| `0002_be2_consultations.sql` | BE2 / PR #22 reference | appointments, consultations, record versions, follow_ups, notifications |
| `0002_be2_consultations.checks.sql` | BE2 | integrity fixture ending in ROLLBACK — empty isolated DB only |
| `0003_be2_appointment_consultation_type.sql` | Wave A | additive nullable `consultation_type` |
| `0004_be1_person_account_bindings.sql` | Wave B sketch | **BLOCKED** — BE1 must own; commented placeholder |
| `0005_be2_notification_phase2.sql` | Phase 2 (was 0003) | devices, preferences, outbox; additive notification columns |

Phase 2 originally used draft number 0003; renumbered to 0005 to avoid colliding with Wave A.

See `docs/audits/persistence-readiness.md`.
