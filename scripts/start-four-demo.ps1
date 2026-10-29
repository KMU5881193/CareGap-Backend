$ErrorActionPreference='Stop'
Set-Location (Join-Path $PSScriptRoot '..')
# Never stop, replace or restart anything listening, including a previous demo.
$client=New-Object Net.Sockets.TcpClient
try{$client.Connect('127.0.0.1',4334);throw 'Port 4334 is already occupied. Reuse the running demo; do not restart it.'}catch [Net.Sockets.SocketException]{}finally{$client.Dispose()}
node --import tsx scripts/prepare-four-accounts.ts
if($LASTEXITCODE -ne 0){throw 'Credential preparation failed'}
$env:CAREGAP_DEMO_ACCOUNTS_FILE=(Resolve-Path .runtime/demo-credentials.json).Path
$env:CAREGAP_RELEASE='isolated-final-20261030'
$repo=(Get-Location).Path
$p=Start-Process pwsh -ArgumentList @('-NoProfile','-File',"$repo/scripts/start-real-ai.ps1",'-Port','4334','-Model','qwen2.5vl:7b') -WindowStyle Hidden -PassThru -RedirectStandardOutput "$repo/.runtime/isolated-server.log" -RedirectStandardError "$repo/.runtime/isolated-server.error.log"
@{launcher_pid=$p.Id;port=4334;root=$repo} | ConvertTo-Json | Set-Content .runtime/isolated-server.json
Write-Output 'Started separate loopback demo on 4334. Existing 4324 and tunnel are untouched. Wait for /health before seeding.'
