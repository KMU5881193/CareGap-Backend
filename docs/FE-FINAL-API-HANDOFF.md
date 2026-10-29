# FE final API handoff

Authoritative request/response route table and examples: HTTP-API.md. Executable sequence: scripts/http-e2e.ts. Release candidate base http://127.0.0.1:4321 on backend PC; existing server remains 4320. /preview/scenario is not part of this server.

Register {identifier,password} at POST /api/auth/register; login same payload at /api/auth/login. Store returned data.access_token in memory and send Authorization: Bearer token. On 401, clear token and log in again. Never send role/admin fields. Password minimum 12 characters.

Use returned person_id, appointment_id, consultation_id, record_version_id and job id; never fixed UUIDs. Job pages show original and edited results, status and current version. Analysis page shows findings/evidence and review_state; recommendation page shows candidates and eligibility_status=unverified. Display synthetic/mock and non-durable storage notices.

Flow: auth → /api/persons → /api/appointments → /api/records → /api/ocr/jobs or /api/stt/jobs → corrections → confirmation → /api/records/import → /api/analyses (Idempotency-Key) → /api/analysis-reviews/:id submit/approve → /api/welfare-recommendations. Consult HTTP-API.md for exact bodies.

A Vite server on a different PC must proxy /api to the backend's approved HTTPS hostname, NOT that PC's localhost. Configure changeOrigin:true and FE_ORIGINS to the browser's exact origin. Production static hosting needs a separate reverse proxy; Vite config is not deployed with static files. Prefer same-origin HTTPS /api forwarding. Keep Access credentials server-side. No remote FE request was executed here.

Errors currently sometimes contain only error.code, without message; FE should display its own code mapping. 401 login, 403 permission, 409 conflict/refetch version, 400 invalid input. This envelope inconsistency remains a release cleanup item.

