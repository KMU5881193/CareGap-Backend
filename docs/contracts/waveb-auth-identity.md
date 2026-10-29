# Wave B — Auth, Identity, Authorization (Phase 1)

## Auth adapter

- Entry: `authenticateAccessToken` / `authenticateAuthorizationHeader` in
  `src/modules/be1-auth/supabase-jwt-auth.ts`
- Verification: injected `SupabaseAuthClient.getUser(accessToken)` (production: `supabase.auth.getUser`)
- Directory: `UserDirectory` (production candidate: `SupabaseUserDirectory` over `users`)
- Role normalize: `PATIENT|patient` → Actor `patient` (etc.)
- Gate: `status === 'APPROVED'` only
- Errors: `{ error: { code, message } }` with 401 / 403 / 404 / 500

Synthetic HTTP sessions (`createIntegratedApp`) remain **opt-in demo only** and are not this adapter.

## Identity Resolver

- `resolvePersonAccountBinding(personId, userId, store)`
- DENY: missing link, unverified, REVOKED, `person_id === user_id`
- Production store: **BLOCKED** until BE1 ships person↔user persistence
- Fail-closed: `BlockedPersonAccountBindingStore`
- Tests: `InMemoryPersonAccountBindingStore`

## AuthorizationPort

- `createRelationAuthorizationPort(store)` — never always-true
- APPROVED `STAFF_ASSIGNMENT` (staff/admin role) → read/write/analyze
- APPROVED `SELF_ACCOUNT` (patient) → read only
- APPROVED `FAMILY_LINK` (family) → read only; write/analyze DENY until product policy
- PENDING / REVOKED → DENY
- `createBlockedAuthorizationPort()` for unavailable BE1 relations
- Appointment staff match: `isAppointmentAssignedStaff` (separate from subject relations)

## Call Eligibility wiring

- Wave A pure function unchanged in spirit: `evaluateCallEligibility`
- Wave B service: `evaluateCallEligibilityForActor` loads appointment + derives participation
- Policy fields unset → DENY
- No production HTTP mount for `/api/calls/*` in this wave

## Operational mount policy

Protected legacy routes stay fail-closed in `src/app.ts`.
Do not mount operational call APIs until BE1 identity/relations are real.
