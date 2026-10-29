param([int]$Port=4324)
$ErrorActionPreference='Stop'
Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 5 | ConvertTo-Json -Depth 8
& "$env:LOCALAPPDATA/Programs/Ollama/ollama.exe" ps
