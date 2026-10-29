-- Draft only. scripts/migrate.ts reads migrations/*.sql and does not read this directory.
-- Do not apply this file. Do not move it to migrations/ until:
--   1) 0002_be2_consultations.sql is accepted and present where the team expects,
--   2) column name, nullability, and backfill rules are decided,
--   3) BE2 owners approve.
--
-- DECISION REQUIRED:
--   - final column name (proposal: consultation_type)
--   - whether existing rows may stay NULL
--   - allowed value vocabulary (PHONE is a product candidate, not a DB enum)
--   - backfill strategy (forbidden until data is surveyed)
--
-- This draft does not alter appointments.status and does not create a PostgreSQL ENUM.

ALTER TABLE appointments
    ADD COLUMN consultation_type text;

COMMENT ON COLUMN appointments.consultation_type IS
    'Optional consultation channel/type. Open string. Not a user id. PHONE is a candidate value only after product agreement. NULL means unset.';
