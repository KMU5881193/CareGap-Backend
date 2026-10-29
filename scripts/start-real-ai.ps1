$ErrorActionPreference='Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$root=Split-Path (Get-Location).Path
$env:PORT='4322'
$env:CAREGAP_SYNTHETIC_HTTP='1'
$env:ANALYSIS_PROVIDER='ollama'
$env:OLLAMA_MODEL='qwen2.5vl:7b'
$env:STT_PROVIDER='local'
$env:STT_PYTHON_PATH=Join-Path $root 'CareGap-Backend-STT/experiments/stt/.venv/Scripts/python.exe'
$env:STT_MODEL_PATH=Join-Path $root 'CareGap-Backend-STT/experiments/stt/models/base'
$env:OCR_PROVIDER='python'
$env:OCR_ENGINE='handwriting-line'
$env:OCR_PYTHON_PATH=Join-Path $root 'CareGap-Backend/experiments/handwriting-ocr/.venv/Scripts/python.exe'
$env:OCR_WORKER_PATH=Join-Path $root 'CareGap-Backend/experiments/handwriting-ocr/worker.py'
node --import tsx scripts/integrated-server.ts
