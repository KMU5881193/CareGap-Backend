param([string]$BaseUrl='http://127.0.0.1:4324')
$ErrorActionPreference='Stop'
Set-Location (Join-Path $PSScriptRoot '..')
New-Item -ItemType Directory -Force .runtime | Out-Null
& pwsh -NoProfile -File scripts/new-synthetic-audio.ps1
$root=Split-Path (Get-Location).Path
& "$root/CareGap-Backend/experiments/handwriting-ocr/.venv/Scripts/python.exe" scripts/new-synthetic-image.py
if($LASTEXITCODE -ne 0){throw 'Synthetic image preparation failed'}
$identifier='synthetic-demo-'+[Guid]::NewGuid().ToString('N')
$password=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
$body=@{identifier=$identifier;password=$password} | ConvertTo-Json
Invoke-RestMethod "$BaseUrl/api/auth/register" -Method Post -ContentType application/json -Body $body | Out-Null
$login=Invoke-RestMethod "$BaseUrl/api/auth/login" -Method Post -ContentType application/json -Body $body
$headers=@{Authorization="Bearer $($login.data.access_token)"}
$person=Invoke-RestMethod "$BaseUrl/api/persons" -Method Post -ContentType application/json -Headers $headers -Body '{}'
@{base_url=$BaseUrl;identifier=$identifier;password=$password;person_id=$person.data.person_id} | ConvertTo-Json | Set-Content .runtime/synthetic-account.json
Write-Output 'Synthetic account created in .runtime/synthetic-account.json (ignored by Git). Do not share credentials in logs. Upload scripts/new-synthetic.wav or .png in FE; inference has not been precomputed.'
