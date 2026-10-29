# Synthetic integrated HTTP service

This supersedes the runtime limitations in ALL-BACKEND-INTEGRATION.md.
All data must be synthetic. Start requires CAREGAP_SYNTHETIC_HTTP=1;
NODE_ENV=production is rejected. No seeded accounts or admin registration.
Registration provisions a synthetic staff account only. This is not real staff
approval. Passwords are scrypt-hashed with random salts; opaque bearer tokens
expire after one hour and logout revokes them. Restart removes every account,
session, appointment, record and AI job. STORAGE_MODE=memory only; any other value
fails startup. Real DB persistence is not implemented.

## Windows

```powershell
corepack pnpm install --frozen-lockfile
$env:FE_ORIGINS='http://localhost:5173,http://FE_PC_IP:5173'
powershell -ExecutionPolicy Bypass -File scripts/start-integrated.ps1
```

Port 4320, loopback by default. One server process per port.
Test: `node --import tsx scripts/http-e2e.ts` (requires running server).
The test creates fresh synthetic accounts and never prints passwords or tokens.

## Common contract

JSON success: {data:...}; errors: {error:{code:...}}. Welfare also returns
connection provenance. Send Content-Type: application/json. After login send
Authorization: Bearer ACCESS_TOKEN. No token in URL. Auth endpoints are limited
to 30 requests/minute per direct peer. Behind Tunnel this limit is shared.
Origins must exactly match comma-separated FE_ORIGINS. No wildcard or cookies.

| Method/path | Request / behavior |
| --- | --- |
| GET /health | storage/provider/synthetic metadata |
| POST /api/auth/register | {identifier,password}; password 12–128 chars; synthetic staff only |
| POST /api/auth/login | same body; returns access_token, expires_in, actor, metadata |
| POST /api/auth/logout | {}; revokes token; 204 |
| GET /api/auth/me | current actor |
| POST /api/persons | {}; creates synthetic subject assigned to current actor |
| POST /api/appointments | {person_id,starts_at,ends_at}; UTC ISO strings; 201 |
| GET /api/appointments | owned appointments |
| POST /api/records | {person_id,text}; creates immutable record version; 201 |
| GET /api/records?person_id=UUID | authorized versions |
| POST /api/ocr/jobs | {person_id,request_key,filename,mimeType,base64}; PNG/JPEG; 202 |
| POST /api/stt/jobs | same; WAV; 202 |
| GET /api/{ocr,stt}/jobs/:id | poll until succeeded/failed |
| POST /api/ocr/jobs/:id/corrections | {expected_version:0,text} |
| POST /api/stt/jobs/:id/corrections | {expected_version:0,segments:[{start_ms,end_ms,speaker_id,text}]} |
| POST /api/{ocr,stt}/jobs/:id/confirmation | {expected_version:1} |
| POST /api/records/import | {source:"ocr" or "stt",job_id}; confirmed owned result only; repeated import returns same record |
| POST /api/analyses | {person_id,past:[{consultation_id,record_version_id}],current:{consultation_id,record_version_id}}; Idempotency-Key required |
| GET /api/analyses/:id | draft/status/version |
| POST /api/analysis-reviews/:id | {action:"submit",expected_version:1}, then {action:"approve",expected_version:2} |
| POST /api/welfare-recommendations | {analysis_id,expected_analysis_version:3,confirmations:[{need:"meal_support",finding_index:0,evidence_index:1,confirmed:true}]} |

Version numbers above assume one correction/submit/approve; use returned current
version after additional edits. See http-e2e.ts for executable full request flow.
BE2 conflict policy: scheduled appointments occupy time; overlapping staff or
subject intervals conflict (409), adjacent appointments do not. Record persistence
is an explicit process-local Map adapter validated with BE2 contracts. Existing
availability/lifecycle domain functions remain included; no availability management
or appointment cancellation HTTP endpoints are implemented in this iteration.

## Providers

Defaults: OCR_PROVIDER=mock, STT_PROVIDER=mock, ANALYSIS_PROVIDER=mock.
Mock outputs are synthetic. Synthetic analysis recognizes only its documented
fixtures; unsupported texts produce unknown findings, not real model reasoning.
Welfare catalog is synthetic and eligibility remains unverified.
OCR_PROVIDER=python requires absolute OCR_PYTHON_PATH and Tesseract dependencies.
STT_PROVIDER=local requires absolute STT_PYTHON_PATH, STT_MODEL_PATH and Whisper
dependencies. Both use existing provider adapters; neither model was executed
in this integration verification. Invalid provider configuration fails closed.
External analysis providers are not wired and startup rejects non-mock settings;
no API keys were loaded or used. Docker profile supports Mock only.

## Docker

```powershell
docker compose up --build -d
docker compose ps
docker compose logs api
docker compose down
```

Stop the Windows 4320 process before starting Compose. Compose publishes only
127.0.0.1:4320, runs non-root and uses ephemeral memory. Docker CLI is unavailable
on the verification computer; image build/start remains unverified.

## FE from another PC / Cloudflare

No tunnel has been published. Recommended setup: run FE and its /api proxy on
this Windows computer, then publish the FE through an email-protected Tunnel.
Vite proxy: '/api': {target:'http://127.0.0.1:4320',changeOrigin:true}.
Set FE_ORIGINS to the exact resulting HTTPS FE origin and restart the API.
FE uses fetch('/api/...') with the bearer token in Authorization.
Configure Vite allowedHosts with the exact tunnel hostname, never true.

With a current cloudflared version:

```powershell
cloudflared tunnel --url http://localhost:5173 --allowed-mail YOUR_TEAM_EMAIL
```

Replace YOUR_TEAM_EMAIL before running; this is a placeholder, not a saved user.
Use the protected FE URL on the other computer; sign in via the Cloudflare email
gate, then register/login to the synthetic API. Keep the API on loopback. No
Windows inbound API firewall rule is needed. For a named Tunnel, configure its
published hostname to the FE local service and create a Cloudflare Access allow
policy for the team before enabling it. This avoids cross-origin Access redirects.
If FE must remain hosted separately, use its server-side /api proxy to a protected
API Tunnel; do not put Access service credentials in browser code.
No second-PC, Cloudflare Access or tunnel request has been validated here.

Official references:
https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/
https://developers.cloudflare.com/tunnel/get-started/
