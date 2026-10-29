param([int]$Port=4324)
$ErrorActionPreference='Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$repo=(Get-Location).Path
New-Item -ItemType Directory -Force .runtime | Out-Null
try { $health=Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 2; if($health.data.release -like 'final-*'){ $health | ConvertTo-Json -Depth 8; exit 0 }; throw 'Port belongs to another server' } catch { if($_.Exception.Message -eq 'Port belongs to another server'){throw} }
$models=Invoke-RestMethod http://127.0.0.1:11434/api/tags -TimeoutSec 5
if('qwen2.5vl:7b' -notin $models.models.name){throw 'Required installed Qwen model unavailable'}
Invoke-RestMethod http://127.0.0.1:11434/api/generate -Method Post -ContentType application/json -Body '{"model":"qwen2.5vl:7b","keep_alive":"15m","stream":false}' -TimeoutSec 120 | Out-Null
$env:CAREGAP_RELEASE='final-'+(git rev-parse --short HEAD)
$root=Split-Path $repo
foreach($file in @("$root/CareGap-Backend-STT/experiments/stt/.venv/Scripts/python.exe","$root/CareGap-Backend-STT/experiments/stt/models/base/model.bin","$root/CareGap-Backend/experiments/handwriting-ocr/.venv/Scripts/python.exe","$root/CareGap-Backend/experiments/handwriting-ocr/worker.py")){if(!(Test-Path -LiteralPath $file)){throw "Missing required inference file: $file"}}
$p=Start-Process pwsh -ArgumentList @('-NoProfile','-File',"`"$repo/scripts/start-real-ai.ps1`"",'-Port',"$Port",'-Model','qwen2.5vl:7b') -WindowStyle Hidden -PassThru -RedirectStandardOutput "$repo/.runtime/server.log" -RedirectStandardError "$repo/.runtime/server.error.log"
@{launcher_pid=$p.Id;port=$Port;root=$repo;started=$p.StartTime.ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content .runtime/server.json
for($n=0;$n -lt 30;$n++){Start-Sleep -Milliseconds 500;try{$h=Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 2;if($h.data.providers.analysis -ne 'ollama'){throw 'Wrong provider'};$h | ConvertTo-Json -Depth 8;exit 0}catch{}}
throw 'Server did not become ready. Inspect .runtime/server.error.log'
