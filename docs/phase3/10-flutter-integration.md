# Flutter (Android / iOS) — Staging Call Integration

BASE_URL is **NOT DEPLOYED** until Render (or equivalent) is live.  
Ask the backend owner for the HTTPS origin; do **not** hard-code a guessed URL.

Never embed `LIVEKIT_API_SECRET`, `CALL_STAGING_TOKEN_SECRET`, or account passwords in the app binary beyond the two test logins provided for staging QA (prefer CI secrets / secure storage).

## 1. Login

`POST {BASE_URL}/api/staging/auth/login`

```json
{ "username": "<staff-or-patient>", "password": "<staging-password>" }
```

Store `data.access_token`, `data.participant_id`, `data.role`, `data.expires_at`.

## 2. WebSocket

Connect after login:

`wss://<host>/ws?access_token=<access_token>`

Subscribe to events; on `call.incoming` show accept/decline UI.

## 3. Place call (staff typical)

`POST {BASE_URL}/api/staging/calls`  
Header: `Authorization: Bearer <token>`  
Body: `{}` (server selects the other approved participant)

## 4. Accept / decline / end

- Accept: `POST …/api/staging/calls/{callId}/accept`
- Decline: `POST …/api/staging/calls/{callId}/decline`
- End: `POST …/api/staging/calls/{callId}/end`

## 5. LiveKit join

After `call.accepted` / `call.connecting` (or REST shows `CONNECTING`):

`POST …/api/staging/calls/{callId}/join-token`  
Body: `{}`

Response `data`:

```json
{
  "call_id": "…",
  "room_name": "cg_…",
  "identity": "caller_…",
  "token": "<livekit-jwt>",
  "livekit_url": "wss://….livekit.cloud",
  "expires_at": "…",
  "token_generation": 1
}
```

Connect with official LiveKit Flutter SDK using `livekit_url` + `token`. Audio only (microphone). Do not publish camera.

## 6. media-ready

When the room reports connected:

`POST …/api/staging/calls/{callId}/media-ready`

Server moves to `ACTIVE` only after **both** sides report.

## 7. State machine (client)

`RINGING → ACCEPTED/CONNECTING → ACTIVE → ENDED`  
Also: `DECLINED`, `MISSED`, `FAILED`

## 8. Error codes (selected)

| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHENTICATED` | 401 | Missing/invalid Bearer |
| `INVALID_CREDENTIALS` | 401 | Bad login |
| `FORBIDDEN` | 403 | Wrong party / demo header / client room spoof |
| `TOKEN_DENIED` | 403 | Join before accept / after end |
| `RATE_LIMITED` | 429 | Slow down |
| `LIVEKIT_CONFIG_MISSING` | 503 | Server misconfigured |
| `CALL_BUSY` / `CALL_EXPIRED` | 409/410 | Session conflicts |

## 9. Security rules for app code

- Do not send `X-Demo-Participant`
- Do not send client-chosen `room_name` / LiveKit identity
- Do not ship LiveKit API key/secret
- Refresh login when access token nears `expires_at`
