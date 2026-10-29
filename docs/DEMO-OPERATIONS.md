# Demo operations

Use PowerShell7, existing Node/pnpm, Windows Python environments and installed Qwen. Do not download models. All paths below are relative to this release worktree.

```powershell
pwsh -NoProfile -File scripts/start-final-demo.ps1
pwsh -NoProfile -File scripts/check-final-demo.ps1
pwsh -NoProfile -File scripts/prepare-synthetic-demo.ps1
```
Default final server4324;4323 was occupied. Existing4320/4321 Docker and4322 real server are preserved. Start checks health, required provider paths, installed Qwen, warms it15minutes, launches hidden process and saves own PID/start-time. Repeating start does not replace an existing server. State/logs in ignored `.runtime/`. Do not publish `.runtime/host-ai.key` or `synthetic-account.json`.

If Ollama is unavailable, start the existing Ollama app, then repeat start. No system reboot, driver install, model download, or paid API required. Stop/restart only this worktree's tracked server:
```powershell
pwsh -NoProfile -File scripts/stop-final-demo.ps1
pwsh -NoProfile -File scripts/start-final-demo.ps1
pwsh -NoProfile -File scripts/prepare-synthetic-demo.ps1
```
This loses in-memory state. Log in with the newly prepared synthetic account; old tokens are invalid. Scripts refuse unexpected process identities. Windows automatic boot recovery is not installed; these commands are the verified manual recovery path.

## Public FE tunnel
```powershell
& 'C:\Program Files (x86)\cloudflared\cloudflared.exe' tunnel --protocol http2 --url http://127.0.0.1:4324 --no-autoupdate
```
Use the actual generated HTTPS hostname. Current validated URL is in FE handoff; a new tunnel gets a new hostname. Never tunnel11434 or4326. Quick Tunnel is public and self-registration is open with rate/capacity limits; synthetic data only. Vite strips Origin on server-side proxy and forwards Bearer. Direct browser calls require exact FE_ORIGINS allowlisting. A401 from address-bar `/api` is expected; health should return200. Cloudflare Access is not configured. End the tunnel when the session ends.

## Docker hybrid
Generate fixtures first, then:
```powershell
pwsh -NoProfile -File scripts/start-docker-final.ps1
docker exec -e API_BASE_URL=http://127.0.0.1:4320 caregap-final-real-ai-api-1 node --import tsx scripts/final-e2e.ts
docker exec -e API_BASE_URL=http://127.0.0.1:4320 -e E2E_SOURCE=ocr caregap-final-real-ai-api-1 node --import tsx scripts/final-e2e.ts
```
Host API4325 maps container4320; FE stays on Windows4324 unless deliberately switching. Container uses host.docker.internal11434 (verified), and authenticated loopback4326 bridge for existing Windows Python OCR/STT. Bridge is not tunneled, rejects missing token401, serializes inference, and allows no client-supplied executable paths. Docker uses non-root node and a writable report folder. This depends on Windows models/venvs, not a standalone Linux AI image. Compose restart policy restarts only the container, not Windows providers. No original compose projects are stopped.

## Three-minute presentation
Before presentation: start server, check `ollama ps`100%GPU, prepare synthetic account/subject/audio/image, open FE and log in. Preparation does not precompute analysis. Keep_alive15m expires or models can unload under memory pressure; check/warm shortly before presentation. Do not load Gemma concurrently.

Show actual WAV upload or image upload → original model text → correct and confirm → imported record → real analysis → selected exact source quotes → reviewer submit/approve → synthetic welfare candidates. Automated full flows are under13sec in measured warm runs, excluding human screen interaction. Cold model load can be slower. The JSON example is a saved real result for outage fallback only; explicitly label it prerecorded, never live.

## Failure checks
Look at `.runtime/server.error.log`, `.runtime/host-ai.error.log`, Docker logs. Failed analysis must not be approved. Information-insufficient INVALID_ANALYSIS requires more source information, not disabling guards. OCR/STT busy/failed jobs require retry after provider recovery. New scenario means new account/record IDs/idempotency key; exact same request retries may reuse the original analysis. External HTTPS503 requires checking local health first, then restarting only the tunnel if local works.
