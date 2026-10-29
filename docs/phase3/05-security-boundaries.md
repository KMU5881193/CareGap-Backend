# Security Boundaries

## Enforced in this prototype

- Demo server refuses `NODE_ENV=production`.
- Demo binds `127.0.0.1` only.
- Browser Origin allow-list for demo HTTP/WS.
- Demo limited to `demo-staff` / `demo-patient`.
- Production `src/app.ts` does not expose `/api/demo/*`, `/api/staging/*`, or `/api/calls/*`.
- Staging (`CALL_STAGING_ENABLED=true`) requires Bearer access tokens; rejects `X-Demo-Participant`.
- Staging login uses scrypt password verification + HMAC access tokens; rate-limited.
- Clients cannot choose LiveKit room name / identity / arbitrary callee on staging.
- LiveKit API key/secret used only server-side.
- Join tokens: room-scoped, microphone-only, no roomAdmin/roomRecord, short TTL.
- Tokens denied before accept and after terminal states.
- Room names / media identities are random opaque strings (no email/phone/name).
- `DenyAllCallAuthorizationAdapter` models production fail-closed until BE1 links exist.

## Known limitation — JWT reuse before TTL

LiveKit participant JWTs cannot be cryptographically revoked before expiry from this codebase alone.

Mitigations implemented:

1. Delete LiveKit room on call end.
2. Remove both participants via Room Service.
3. Bump `token_generation` and refuse further join-token API calls.
4. Unique room names per session (ended room name is not reused).

**Security status:** API-level rejoin after end is denied and the room is deleted, but a stolen JWT might still be usable against LiveKit **until TTL expires if the same room name were recreated**. Because room names are high-entropy and not reused, practical risk is reduced. Full pre-expiry reconnect blocking is therefore **PARTIAL / not complete** — do not treat token security as fully closed for production.

## Forbidden

- Always-true production authorization
- Client-supplied arbitrary room names
- Unauthenticated public token endpoints on `app.ts`
- Committing secrets
- Logging PII
- Automatic call recording
