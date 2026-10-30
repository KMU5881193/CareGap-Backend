# CareGap Phase 3 — Independent Call Prototype

Isolated LiveKit voice-call harness. Not part of the production Express app.

## Quick start (Windows PowerShell)

```powershell
# repo root
pnpm install
pnpm call:demo:server

# other terminal
pnpm --dir examples/call-prototype/web install
pnpm call:demo:web
```

Open two Chrome windows → `http://127.0.0.1:5173` → different roles → call / accept.

Requires `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` in repo `.env`.

See `docs/phase3/` for architecture, security, and the manual E2E checklist.
