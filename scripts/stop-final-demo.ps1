$ErrorActionPreference='Stop'
$state=Get-Content (Join-Path $PSScriptRoot '../.runtime/server.json') -Raw | ConvertFrom-Json
$p=Get-Process -Id $state.launcher_pid -ErrorAction SilentlyContinue
if(!$p){exit 0}
if($p.StartTime.ToUniversalTime().Ticks -ne ([DateTime]$state.started).ToUniversalTime().Ticks){throw 'PID was reused; refusing to stop'}
$children=Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $p.Id -and $_.Name -ne 'conhost.exe' }
foreach($child in $children){if($child.Name -ne 'node.exe' -or $child.CommandLine -notmatch 'scripts/integrated-server.ts'){throw 'Unexpected child; refusing to stop'}}
foreach($child in $children){Stop-Process -Id $child.ProcessId}
Stop-Process -Id $p.Id -ErrorAction SilentlyContinue
