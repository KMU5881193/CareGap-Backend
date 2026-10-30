# Call Prototype API Contract (Demo Only)

Base URL: `http://127.0.0.1:4091`  
Auth header: `X-Demo-Participant: demo-staff | demo-patient`  
Allowed browser Origins: `http://127.0.0.1:5173`, `http://localhost:5173` (+ preview 4173)

These routes exist **only** on the isolated demo server. They are **not** mounted on `src/app.ts`.

## REST

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness + LiveKit configured flag |
| `GET` | `/api/demo/participants` | Synthetic participants |
| `POST` | `/api/demo/calls` | Create call (`{ callee_id }`) |
| `GET` | `/api/demo/calls/:callId` | Session snapshot for participant |
| `POST` | `/api/demo/calls/:callId/accept` | Callee accept |
| `POST` | `/api/demo/calls/:callId/decline` | Callee decline |
| `POST` | `/api/demo/calls/:callId/end` | End / cancel |
| `POST` | `/api/demo/calls/:callId/join-token` | LiveKit JWT (post-accept) |
| `POST` | `/api/demo/calls/:callId/media-ready` | Report WebRTC connected |

### Success envelope

```json
{ "data": { "call_id": "...", "state": "RINGING", "state_version": 1 } }
```

### Error envelope

```json
{ "error": { "code": "TOKEN_DENIED", "message": "..." } }
```

## WebSocket

`ws://127.0.0.1:4091/ws?participant=demo-staff`

Events: `call.incoming`, `call.ringing`, `call.accepted`, `call.declined`, `call.connecting`, `call.active`, `call.ended`, `call.missed`, `call.failed`.

Each event includes `event_id`, `call_id`, `state_version`, `occurred_at`.

## Future production mapping (not implemented)

| Demo | Future production |
|---|---|
| `POST /api/demo/calls` | `POST /api/calls` + eligibility |
| `X-Demo-Participant` | BE1 Supabase JWT |
| Local WS | Authenticated call signaling gateway |
| Synthetic authz | RelationAuthorizationPort + CallEligibility |
