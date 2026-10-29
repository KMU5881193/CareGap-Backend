-- DRAFT ONLY. Do not apply. Do not move to migrations/ until BE1 owns and approves
-- the persistence model (Prisma or SQL). scripts/migrate.ts does not read drafts/.
--
-- Purpose: illustrate person_id ↔ user_id separation required by Wave B Identity Resolver.
-- person_id is NOT user_id. Equality of UUIDs must never create a binding.
--
-- BLOCKED on BE1: table/column names, verification workflow, uniqueness, revoke semantics.
-- Family links and staff assignments are separate relations; do not overload this table.

-- CREATE TABLE person_account_bindings (
--     binding_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--     person_id UUID NOT NULL,
--     user_id UUID NOT NULL REFERENCES users(user_id),
--     verified boolean NOT NULL DEFAULT false,
--     status text NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
--     created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
--     CONSTRAINT person_account_bindings_person_ne_user CHECK (person_id <> user_id)
-- );
--
-- -- Suggested uniqueness (DECISION REQUIRED with BE1):
-- -- CREATE UNIQUE INDEX person_account_bindings_active_person_user
-- --   ON person_account_bindings (person_id, user_id)
-- --   WHERE status = 'ACTIVE';

SELECT 1; -- placeholder so the file is valid SQL commentary carrier
