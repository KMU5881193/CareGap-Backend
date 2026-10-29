# Release verification

Runtime image: caregap-api:9f27ae5 (linux/amd64). Branch integration/all-backend-20261030.
Base 299d763; added PR17 5f37ea5, PR18 0ae0a68, PR19 4fe1bf7, PR20 222d009 by ancestry-aware merges. PR18 README conflict retained both domain descriptions. Existing PR4–15 and merged main PR16 remain included. Latest remote main unchanged at 6ddcb5f. PR5 and PR14 remain Draft; no remote mutations.

27 files / 529 tests pass; frozen install, typecheck, build pass. Initial sandbox HTTP tests failed EACCES; normal-permission rerun passed without test edits. Container HTTP E2E: 34 PASS on 4321. Healthy, user node, linux/amd64. Existing 4320 container preserved.

HTTP connected: synthetic auth/session/logout, owned subjects, appointment creation/list/conflict, immutable records, OCR/STT jobs/correction/confirmation/import, evidence-bound analysis/review, confirmed-need welfare candidates.
Mock/synthetic: all model execution and welfare catalog; sessions/data are volatile memory. Real staff approval and real DB are not implemented.
Domain only: availability/lifecycle, analysis-event deduplication (#17), follow-up (#18), notifications (#19). Role contract uses patient after #20.

Remaining verification: additional requested HTTP negative cases (expiry, wrong versions, malformed MIME, duplicate analysis keys and restart reset) have not all been rerun against this container. Remote FE and Ubuntu deployment unverified. Thus full final-release acceptance remains incomplete, despite current regression and baseline E2E passing.
Merge strategy: review integration safety changes with original PR dependency chains 4→5, 6→7→14, 10–13→15→17, 18→19→20. Preserve original PRs; no push/main merge before user confirmation. Current validation supports continued review, not unconditional production readiness.

