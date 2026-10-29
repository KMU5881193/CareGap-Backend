# Ubuntu transfer

Verified image caregap-api:9f27ae5, linux/amd64, non-root, Mock/memory only. Archive caregap-api-9f27ae5.tar in integration folder. No remote deployment performed.

Windows:
```powershell
Get-FileHash caregap-api-9f27ae5.tar -Algorithm SHA256
scp caregap-api-9f27ae5.tar USER@SERVER:/tmp/
```
Replace USER/SERVER locally. No password/key in documents.

Ubuntu:
```bash
sha256sum /tmp/caregap-api-9f27ae5.tar
# Compare with Windows checksum before load.
docker load -i /tmp/caregap-api-9f27ae5.tar
ss -ltn | grep -E ':4321\b'
# Continue only if 4321 is free.
docker run -d --name caregap-rc-9f27ae5 -p 127.0.0.1:4321:4320 -e PORT=4320 -e API_HOST=0.0.0.0 -e CAREGAP_SYNTHETIC_HTTP=1 -e FE_ORIGINS=https://YOUR_FE_HOST caregap-api:9f27ae5
curl --fail http://127.0.0.1:4321/health
```
Use operator-approved HTTPS reverse proxy or protected Tunnel to loopback, preserving existing 80/443/4010/8080 services. Replace YOUR_FE_HOST with exact origin. Registration/login smoke test bodies are in HTTP-API.md; use newly generated synthetic credentials, not seeded accounts.

Stop/restart only this container: docker stop caregap-rc-9f27ae5 / docker start caregap-rc-9f27ae5. Restart loses all data. Rollback by switching operator-controlled routing to prior container; leave prior image/container intact. Do not stop existing unrelated services.

