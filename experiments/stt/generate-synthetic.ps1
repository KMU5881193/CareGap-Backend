# Existing installed Korean TTS voice only. No download or real counseling recording.
$ErrorActionPreference = 'Stop'
$sampleDirectory = Join-Path $PSScriptRoot 'samples'
[System.IO.Directory]::CreateDirectory($sampleDirectory) | Out-Null
$voice = New-Object -ComObject SAPI.SpVoice
$korean = @($voice.GetVoices() | Where-Object { $_.GetDescription() -match 'Korean|Heami' })
if ($korean.Count -eq 0) { throw 'No installed Korean SAPI voice; do not install a system voice automatically.' }
$voice.Voice = $korean[0]
$stream = New-Object -ComObject SAPI.SpFileStream
$format = New-Object -ComObject SAPI.SpAudioFormat
$format.Type = 18 # SAPI SAFT16kHz16BitMono; backend verifies the actual WAV header.
$stream.Format = $format
$target = Join-Path $sampleDirectory 'synthetic-ko.wav'
$text = '최근 식사는 하루 두 번 했습니다. 어제는 통증이 없었습니다.'
try {
    $stream.Open($target, 3, $false)
    $voice.AudioOutputStream = $stream
    $voice.Rate = 0
    $voice.Speak($text) | Out-Null
} finally {
    $stream.Close()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($stream) | Out-Null
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($voice) | Out-Null
}
Write-Output 'Generated synthetic Korean TTS only; not human or multi-speaker speech.'
Write-Output $target
