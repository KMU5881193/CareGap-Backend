# Phase 3B — Secure Staging API Contract

Local demo (`examples/call-prototype`, `X-Demo-Participant`) remains **localhost-only**.  
External Android/iOS/Flutter clients must use this **staging** surface.

| Surface | Entry | Auth | Bind |
|---|---|---|---|
| Local demo | `pnpm call:demo:server` | `X-Demo-Participant` | `127.0.0.1` only; **forbidden** when `NODE_ENV=production` |
| Staging | `pnpm call:staging:start` (`src/call-staging-server.ts`) | Bearer access token | `0.0.0.0` + platform `PORT`; requires `CALL_STAGING_ENABLED=true` |
| Production app | `src/app.ts` | BE1 JWT (notifications) | Does **not** mount call staging or demo routes |

## Base URL

**NOT DEPLOYED** until a Render (or other) service is created.  
After deploy, use the platform HTTPS origin, e.g. `https://<your-service>.onrender.com`  
WebSocket: `wss://<your-service>.onrender.com/ws?access_token=<token>`

Do not treat any placeholder URL as live.

## Authentication

### `POST /api/staging/auth/login`

```json
{ "username": "staff.tester", "password": "••••••••••••" }
```

Response:

```json
{
  "data": {
    "access_token": "<jwt>",
    "token_type": "Bearer",
    "expires_at": "2026-10-30T01:00:00.000Z",
    "participant_id": "demo-staff",
    "role": "staff",
    "username": "staff.tester"
  }
}
```

Only two approved accounts exist (staff + patient). Passwords live in server env only.

### HTTP Authorization

```
Authorization: Bearer <access_token>
```

`X-Demo-Participant` is **rejected** (403) on staging.

## Call REST (Bearer required)

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/staging/calls` | Callee is the **other** approved account (client cannot pick arbitrary ids) |
| `GET` | `/api/staging/calls/:callId` | Participant-only |
| `POST` | `/api/staging/calls/:callId/accept` | Callee |
| `POST` | `/api/staging/calls/:callId/decline` | Callee |
| `POST` | `/api/staging/calls/:callId/end` | Either party |
| `POST` | `/api/staging/calls/:callId/join-token` | After accept; body must not set room/identity |
| `POST` | `/api/staging/calls/:callId/media-ready` | After LiveKit `connected` |

`GET /health` — public liveness (no secrets).

## WebSocket

```
wss://<host>/ws?access_token=<access_token>
```

Forbidden: `?participant=…` (identity from token only).  
Optional alternate: `Sec-WebSocket-Protocol: bearer, <token>`.

Events match the local demo: `call.incoming`, `call.ringing`, `call.accepted`, `call.declined`, `call.connecting`, `call.active`, `call.ended`, `call.missed`, `call.failed`.

## Mapping from local demo paths

| Local demo | Staging |
|---|---|
| `X-Demo-Participant` | `Authorization: Bearer …` after login |
| `POST /api/demo/calls` | `POST /api/staging/calls` |
| `…/api/demo/calls/:id/*` | `…/api/staging/calls/:id/*` |
| `ws://127.0.0.1:4091/ws?participant=` | `wss://…/ws?access_token=` |
