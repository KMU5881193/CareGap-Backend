# Demo runbook

Existing 4320 remains available. Candidate runs on 4321. Check /health and Mock/memory metadata. Generate a new synthetic account; login and use returned token. Follow scripts/http-e2e.ts or HTTP-API.md from subject and appointment through record, OCR/STT confirmation/import, analysis review and welfare.

Validated baseline: 34 real HTTP calls on candidate Docker container; 529 tests. Show original excerpts and latest versions; state that inference is Mock, welfare is synthetic/unverified and data is in memory. No real patient records or external keys.

If OCR/STT infrastructure fails, use POST /api/records with synthetic text to demonstrate analysis, clearly stating the skipped upload stage. Never fabricate a successful job. For conflicts, reload the latest job/version and retry the intended action. For expired token, login again. After restart, register anew and recreate subjects/records; old IDs/tokens are invalid. Restart behavior is specified but not yet revalidated in the release container.

Candidate start: RELEASE_TAG=9f27ae5 docker compose -p caregap-rc -f compose.release.yaml up -d (PowerShell: set $env:RELEASE_TAG first). Existing server is not replaced. Ubuntu and remote FE procedures remain unexecuted.

