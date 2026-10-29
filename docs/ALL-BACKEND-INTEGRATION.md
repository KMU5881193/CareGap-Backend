# Integration verification

Branch: integration/all-backend-20261030. Base main: 6ddcb5f.
PRs 4,5,6,7,8,9,14,10,11,12,13,15 were merged in that order.
PR16 is already squash-merged in main; its original head is not an ancestor.
All BE3 implementation files shared with C 74e2b5a matched after merging.
Only C-exclusive Preview, bridge, tests, fixtures and handoff files were restored;
the duplicate C implementation commits were not cherry-picked.

Validation: typecheck and build exit 0; 22 test files / 490 tests passed.
This includes fail-closed tests for unprotected legacy routes.

## Run on Windows

From this folder, after installing dependencies:

```powershell
corepack pnpm install --frozen-lockfile
powershell -ExecutionPolicy Bypass -File scripts/start-integrated.ps1
```

API: http://127.0.0.1:4320/health
Synthetic scenario: http://127.0.0.1:4320/preview/scenario
Existing port 4313 is preserved. The integrated server binds loopback only.

## FE on another computer

Run the FE dev server on the backend Windows computer with this Vite configuration:

```ts
server: {
  host: '0.0.0.0',
  proxy: {
    '/preview': { target: 'http://127.0.0.1:4320', changeOrigin: true },
    '/health': { target: 'http://127.0.0.1:4320', changeOrigin: true }
  }
}
```

Open http://BACKEND_LAN_IP:5173 from the other computer; FE calls
fetch('/preview/scenario'). Restrict Windows firewall access to the trusted LAN
and FE port. Do not expose the backend port or configure /api proxy publicly.
LAN/firewall connectivity is not verified from a second computer.
The preview rejects foreign Origin headers: strip Origin on the local Vite
proxy request (proxy configure: proxy.on('proxyReq', req => req.removeHeader('origin'))).
Use only fixed synthetic actions in docs/FE-BE3-HANDOFF.md.

## Remaining integration gaps

The merged source is not a complete production API. BE2 PRs implement domain
functions and schemas, not HTTP persistence adapters or finalized lifecycle rules.
BE1 AuthService is an in-memory prototype and login does not issue a session token.
The Supabase middleware is separate and cannot authenticate those prototype logins.
Patient role also differs from the shared person role.
No real credentials or patient data were used.

Legacy staff approval/listing, relationship writes, consultation reads and welfare
routes are disabled with 503 AUTHORIZATION_NOT_CONFIGURED before their handlers.
They previously lacked authentication/subject authorization. BE3 protected router
factories remain present but require a trustworthy actor and subject authorization
adapter before mounting. Preview connects mock OCR/STT, analysis review and welfare
using a fixed synthetic actor and records; this is not real BE1/BE2 integration.
OCR/STT model inference, external LLM, database storage and real authentication
are not runtime-validated. Docker was not selected; Windows execution works.

## main merge assessment

All specified PR content is included locally and the combined suite passes.
Suggested dependency order: 4 -> 5; 6 -> 7 -> 14; 8; 9;
10 -> 11 -> 12 -> 13 -> 15. Retarget stacked PRs only after their base merges.
The package/lock conflict resolution and security guard must accompany main
integration. Do not treat passing domain tests as production API readiness.
No remote push or main merge was performed. Recheck heads/CI before merging.
