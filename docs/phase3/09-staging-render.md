# Render Deployment — Call Staging

Deploy branch that contains Staging (`call:staging:start`), currently
`feature/be2-call-prototype` (commit with secure call staging).
`feature/be2-call-staging` without that commit will fail Start Command.

## Render Dashboard — exact fields

| Field | Value |
|---|---|
| **Runtime** | Node |
| **Build Command** | `pnpm install --frozen-lockfile && pnpm build` |
| **Start Command** | `pnpm call:staging:start` |
| **Health Check Path** | `/health` |

Equivalent Start Command (same script): `node dist/call-staging-server.js`

## Build / Start (local parity)

| Step | Command |
|---|---|
| Install | `pnpm install --frozen-lockfile` |
| Build | `pnpm build` (`tsc` → `dist/`) |
| Start | `pnpm call:staging:start` → `node dist/call-staging-server.js` |
| Health | `GET /health` |

Blueprint: repo-root `render.yaml` (`caregap-call-staging`).

## Binding

- Listen host: `CALL_STAGING_BIND_HOST` default `0.0.0.0`
- Port: platform `PORT` (required)
- TLS: terminated by Render; app speaks HTTP locally; clients use **HTTPS/WSS** only

## Required environment variables

| Variable | Purpose |
|---|---|
| `CALL_STAGING_ENABLED=true` | Gate |
| `CALL_STAGING_TOKEN_SECRET` | ≥32 chars HMAC secret for access tokens |
| `CALL_STAGING_STAFF_USERNAME` / `CALL_STAGING_STAFF_PASSWORD` | Staff test account (≥12 char password) |
| `CALL_STAGING_PATIENT_USERNAME` / `CALL_STAGING_PATIENT_PASSWORD` | Patient test account |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | LiveKit Cloud |
| `PORT` | Injected by Render |
| `CALL_STAGING_TRUST_PROXY=true` | Trust `X-Forwarded-For` for rate limits |
| `CALL_STAGING_ALLOWED_ORIGINS` | Comma-separated browser Origins (optional; native apps omit Origin) |
| `CALL_STAGING_ACCESS_TOKEN_TTL_SECONDS` | Default `3600` |

Optional: `CALL_STAGING_*_PASSWORD_HASH` + `_SALT` (base64) instead of plaintext password at boot.

## Deploy / rollback

1. Create Web Service from this repo (or apply `render.yaml`).
2. Set secrets in dashboard.
3. Deploy → confirm `GET https://<service>/health` returns `surface: call-staging`.
4. Rollback: redeploy previous successful deploy in Render UI.

## Local staging smoke (not public)

```powershell
$env:CALL_STAGING_ENABLED='true'
$env:PORT='4092'
$env:CALL_STAGING_TOKEN_SECRET='local-dev-secret-at-least-32-chars'
$env:CALL_STAGING_STAFF_USERNAME='staff.tester'
$env:CALL_STAGING_STAFF_PASSWORD='staff-password-12'
$env:CALL_STAGING_PATIENT_USERNAME='patient.tester'
$env:CALL_STAGING_PATIENT_PASSWORD='patient-password-12'
# plus LIVEKIT_* from .env
pnpm build
pnpm call:staging:start
```
