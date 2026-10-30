# BE1 Integration Contract (Future)

## Still BLOCKED today

- Persistent `person_id ↔ user_id` model in BE1
- Staff/family relation schema as operational source of truth
- Appointment DB migration for call eligibility windows
- Real Firebase VoIP / high-priority call invite delivery
- Outbox worker as a production long-running process

## Swap points (already port-shaped)

| Port | Prototype | Production replacement |
|---|---|---|
| `CallIdentityPort` | `SyntheticCallIdentityAdapter` | BE1 IdentityResolver + user directory |
| `CallAuthorizationPort` | Synthetic / DenyAll | Relation store + Wave A `evaluateCallEligibilityForActor` |
| `CallRepositoryPort` | `InMemoryCallRepository` | Postgres `call_sessions` (+ events) |
| `CallMediaProvider` | `LiveKitProvider` | same (keep) |
| `CallSignalingPort` | Local in-process WS | Authenticated gateway + device fan-out |

## Suggested production sequence

1. Persist person↔user bindings and staff assignment relations.
2. Wire eligibility policy (status, consultation_type, join window).
3. Mount authenticated `/api/calls/*` on the main app **only** with Deny-by-default authz.
4. Keep demo harness out of production builds.
5. Add LiveKit webhook raw-body verification for ACTIVE/ENDED media truth.
6. Add iOS PushKit / Android FCM high-priority invite adapters (Phase 3 mobile).

## Android / iOS hook points

- Invite payload: opaque `call_id`, `ringing_expires_at`, no PII room names.
- Accept still goes through server state machine before join-token.
- Native CallKit / Telecom UI is client-side; server remains SoT for call state.

## Explicit non-wiring

Never import `examples/call-prototype/server` from `src/app.ts` or `src/server.ts`.
