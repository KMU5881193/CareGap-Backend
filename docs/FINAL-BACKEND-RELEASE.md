# Final synthetic backend release — 2026-10-30 KST

Branch: `release/caregap-final-real-ai-20261030`. Base `22dd5e0`; real AI history `f498c21`, `f959121`, `15ea53c` retained without cherry-pick duplication. Runtime implementation `c375d1a`, owned-process restart fix `9e4be3b`. Windows process was started at `9e4be3b`; later documentation and Docker readiness-script commits do not change its server source. Original worktrees untouched (existing tar and Gemma logs retained).

## Integration scope
|PR|Disposition|
|---|---|
|#16|Already merged main `6ddcb5f`; retained. Public integrated server uses salted password hashing, expiring opaque sessions and owner authorization. Legacy unauthenticated staff router is not mounted. This remains synthetic demo auth, not production identity management.|
|#4–9, #14|All latest remote heads verified ancestors. OCR, STT, analysis, review and welfare code retained. Actual Windows providers and Qwen are selected for release; OpenAI paid adapter not used.|
|#10–13, #15, #17–19|All latest remote heads verified ancestors. Domain code retained; final HTTP exposes appointments, immutable record versions, follow-ups and own notifications. Automatic analysis-event-to-notification dispatch is not implemented.|
|#20|Latest head `222d009` included; patient role contract retained.|
|#21 `4ac186f`|Reviewed, no wholesale code merge. PostgreSQL repository/draft SQL/router excluded from executable release. Its appointment POST deliberately rejects persistence; database schema was not migrated or verified. Needed record-version, appointment-action, follow-up and notification capabilities are implemented in memory using existing domain functions and integrated session auth. These are final API contracts, not claims that the PR's DB endpoints are mounted.|
|#22 `bf51902`|Reviewed and intentionally excluded: standalone PostgreSQL demo depends on #21 and test authentication. Neither server nor tests are represented as integrated production authentication.|

Latest remote main remains `6ddcb5f`. Existing original PRs overlap this aggregate branch. Do not blindly merge them again after this PR; review ancestry/diffs. No main merge performed.

## Executed checks
- 532 tests in 28 files PASS; typecheck/build PASS; git diff --check PASS.
- Existing Mock HTTP E2E: 34 checks PASS on an isolated ephemeral port, explicitly separate from real inference proof.
- Final Windows real STT→correction→record→Qwen→evidence→approval→welfare→follow-up→notification, independent accounts: **7,536 / 7,065 / 7,764 ms**, 3/3 PASS.
- Qwen inference for those runs: **4,738 / 4,335 / 4,528 ms**; output184 tokens each. prompt evaluation441.904 /115.835 /218.689ms, generation4231.518 /4182.232 /4278.980ms. Exact selected source quotes validated; three improved directions matched independent scenario assertions before approval.
- Real OCR complete flow: 6,389ms in Windows; printed synthetic image raw output `오늘식사는세번했고약을빠뜨리지않았습니다.`. No handwriting-photo accuracy claim.
- Latest public HTTPS full flow: **12,251ms**, real Qwen4834ms. Actual request/response trace: [final-http-example.json](final-http-example.json); credentials/token excluded.
- Docker Linux AMD64 backend built/run; E2E executed **inside** container: real STT full flow **7,563ms**, real OCR full flow **4,540ms**. Windows bridge performs OCR/STT and host Ollama performs Qwen. This is a verified hybrid deployment, not a Linux model migration.
- `host.docker.internal:4324/health` and `:11434/api/tags`: HTTP200 from container. No external forwarding of11434 or4326.
- RTX4060 Ollama: Qwen5.4GB, 100% GPU, context4096. OCR/STT workers CPU; no second model resident. keep_alive15m renewed by inference, not permanent residency.
- Restart/duplicate start/synthetic preparation scripts executed. Initial safe-stop rejection of Windows conhost corrected. Initial Docker report-directory permission error and startup readiness race corrected. No existing4320/4321/4322 process stopped.

## Security and limitations
Anonymous401; cross-owner records/follow-ups403; another mailbox read404; stale record version409; session expiration and restart invalidation checked; revoked tokens401. Unconfirmed OCR/STT import and unapproved recommendation409. Unknown Origin403; exact configured Origin preflight tested. HTTPS Bearer forwarding verified by actual scenario.

Insufficient current meal data: analysis failed `INVALID_ANALYSIS`; submit409 CONFLICT and welfare409 NOT_APPROVED (latest2,738ms). Numeric contradictions, invalid source references, missing Ollama and explicit medication negation contradictions are covered by rejection tests; no Mock fallback. Deterministic semantic checks are intentionally narrow. Ambiguous meaning still requires a human reviewer, and question wording can mix English. Missing medication must not be inflated to permanent cessation. `unknown` generation is not reliably successful and is not reported as fixed.

STT raw output misrecognized `빠뜨리지` as `받들이지`; original timestamps and text are preserved, human correction is separate. No speaker diarization. Welfare catalog is synthetic/unverified and requires explicit staff confirmations.

Memory is nondurable. Restart loses accounts/tokens/records/jobs; prepare script creates fresh synthetic data, not recovery of previous data. Windows service does not auto-start at OS boot; run start script after Ollama/Docker Desktop are ready. Docker restart policy cannot restore missing Windows providers by itself.

Remote FE: public HTTPS was verified from this machine; user reported UNAUTHENTICATED after opening an API in the browser address bar, consistent with missing Bearer header. Another-PC FE login plus actual analysis remains pending, so full FE integration is **not yet certified**.

PR is for review of a synthetic hackathon backend. Main merge should wait for FE acceptance and reviewer agreement on memory storage, source-quote selection, narrow semantics, and Windows hybrid dependencies. No automatic merge.
