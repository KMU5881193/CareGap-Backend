# HTTP integration verification — 2026-10-30 KST

Continued integration/all-backend-20261030 from 8c859d0.
Typecheck exit 0; build exit 0; 23 Vitest files / 492 tests passed.
Final live TCP HTTP E2E at http://127.0.0.1:4320: PASS, 34 requests.
Process 37772 runs scripts/integrated-server.ts at verification completion.

Verified synthetic registration/login -> appointment create/list/conflict ->
past record creation -> PNG OCR and WAV STT upload/poll -> corrections ->
confirmation -> immutable BE2 record imports (idempotent) -> source-bound analysis
-> submit/approve -> staff-confirmed needs -> unverified welfare candidates.
Verified anonymous rejection, cross-user record denial, unconfirmed import
rejection, unapproved recommendation rejection, admin route absence and token
revocation. Automated tests also check Origin restrictions, no client-selected
admin role and fail-closed unsupported configuration.

All new runtime storage is volatile memory; all account/subject/test inputs are
synthetic. Provider run: Mock only. Real model subprocess adapters are selectable
but not runtime-verified. External LLM mode is rejected, not silently mocked.
No DB persistence adapter, real staff approval system, availability/cancellation
HTTP endpoints, second-computer FE run or Cloudflare Tunnel execution was verified.
Docker CLI is absent: Compose and Dockerfile provided but not built/run.
No keys/real records accessed; no GitHub push or main merge performed.

Executable contract, run commands and protected Tunnel setup: HTTP-API.md.
