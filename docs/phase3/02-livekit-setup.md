# LiveKit Setup (Windows)

## 1. LiveKit Cloud project

1. Create a project at [LiveKit Cloud](https://cloud.livekit.io/).
2. Copy **WebSocket URL** (`wss://…`), **API Key**, **API Secret**.
3. Put them only in local `.env` (never commit secrets).

## 2. Environment variables

```env
LIVEKIT_URL=wss://YOUR-PROJECT.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
CALL_PROTOTYPE_ENABLED=true
CALL_PROTOTYPE_PORT=4091
NODE_ENV=development
```

Server-only. The browser receives short-lived join JWTs from the demo API; it never sees the API secret.

## 3. Install

From repo root (Node ≥ 22.12, pnpm):

```powershell
pnpm install
cd examples\call-prototype\web
pnpm install
cd ..\..\..
```

## 4. Run demo (two terminals)

```powershell
# Terminal A — signaling + token server (127.0.0.1 only)
pnpm call:demo:server

# Terminal B — web UI
pnpm call:demo:web
```

Open two Chrome windows to `http://127.0.0.1:5173`, pick `demo-staff` and `demo-patient`.

## 5. Token grant policy

Issued only after accept, for CONNECTING/ACTIVE participants:

- `roomJoin=true`, room scoped to opaque `cg_*` name
- `canPublish=true`, `canPublishSources=["microphone"]`
- `canSubscribe=true`
- `roomAdmin=false`, `roomRecord=false`
- short TTL (default 300s)

## 6. Troubleshooting

| Symptom | Check |
|---|---|
| Accept returns `LIVEKIT_CONFIG_MISSING` | `.env` placeholders or missing keys |
| Browser cannot hear remote audio | Click **오디오 잠금 해제**; allow microphone; confirm both roles connected |
| WS closes immediately | Origin must be `http://127.0.0.1:5173` / `localhost:5173` |
| Demo refuses to start | `NODE_ENV` must not be `production` |
