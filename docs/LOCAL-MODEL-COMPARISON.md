# Actual HTTP comparison — 2026-10-30

Same prompt, JSON schema, 4096 context and 700 output-token ceiling. Separate
servers: Qwen 4322 preserved; Gemma 4323. Models loaded sequentially, never
intentionally co-resident. Both reported 100% GPU. No downloads or paid API.

| Case | Qwen HTTP ms/result | Gemma HTTP ms/result |
|---|---|---|
| meal 3→2 | 2929 / correct | 88945 cold / PROVIDER_ERROR; 12394 warm / same failure |
| daily medication→2 missed days | 2069 / correct | 11757 / correct |
| walks 1→3 | 1894 / correct | 11723 / correct |
| meal unchanged | 1623 / correct | 12002 / correct |
| current unknown | 2650 / INVALID_ANALYSIS | 12348 / PROVIDER_ERROR; 11611 warm / same failure |

Qwen correct successful outputs 4/5, with remaining unsafe inference blocked.
Gemma successful valid outputs 3/5. Exact quote/ID validation passed on successful
outputs. Failed Gemma calls did not produce a validated draft; do not call those
semantically correct or schema compliant. Under this output budget Gemma consumes
666–686 eval tokens even for successful cases, versus Qwen short outputs.
Raw output/evaluation data are comparison-*.json and local server logs.

Selection: retain Qwen for bounded demo, not general semantic correctness.
Information-insufficient output remains a known failure, safely blocked rather
than corrected to a fabricated answer. Qwen descriptions still overstate a two-day
medication miss as complete discontinuation; questions may mix English/Korean.
Human wording review remains necessary.

Latest-guard Qwen normal HTTP scenario repeated 3 times, approximately 4.9, 5.3,
4.3 seconds by provider logs, no version conflicts. Insufficient draft failed
INVALID_ANALYSIS; submission and welfare both returned 409. Real STT→explicit
synthetic correction→confirmation→record→Qwen→approval→welfare completed in
about 12.9 seconds total (LLM/review/recommendation 5.043 seconds). This is automated
processing time, not live human interaction time or a complete FE rehearsal.
Execution used runtime source f959121 plus evaluation-script changes only.

After comparison, Gemma unloaded and Qwen reloaded with keep_alive=15m.
Final ps: qwen2.5vl:7b, 100% GPU, 4096 context. 4322 configuration unchanged.
