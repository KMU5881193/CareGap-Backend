$ErrorActionPreference='Stop'
Set-Location (Join-Path $PSScriptRoot '..')
New-Item -ItemType Directory -Force .runtime | Out-Null
if(!(Test-Path .runtime/host-ai.key)){[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)) | Set-Content .runtime/host-ai.key}
$env:HOST_AI_TOKEN=(Get-Content .runtime/host-ai.key -Raw).Trim()
try{$client=[Net.Sockets.TcpClient]::new('127.0.0.1',4326);$client.Dispose()}catch{
 $repo=(Get-Location).Path
 $p=Start-Process node -ArgumentList @('--import','tsx','scripts/host-ai-server.ts') -WindowStyle Hidden -PassThru -WorkingDirectory $repo -RedirectStandardOutput "$repo/.runtime/host-ai.log" -RedirectStandardError "$repo/.runtime/host-ai.error.log"
 $p.Id | Set-Content .runtime/host-ai.pid
}
$env:PATH="C:\Program Files\Docker\Docker\resources\bin;"+$env:PATH
docker compose -p caregap-final-real-ai -f compose.final.yaml up -d --build
if($LASTEXITCODE -ne 0){throw 'Docker build/start failed'}
