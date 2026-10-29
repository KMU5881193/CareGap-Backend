$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot/..
$env:PORT = '4320'
$env:CAREGAP_SYNTHETIC_HTTP = '1'
& ./node_modules/.bin/tsx.cmd scripts/integrated-server.ts
