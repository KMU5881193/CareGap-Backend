$ErrorActionPreference='Stop'
$voice=New-Object -ComObject SAPI.SpVoice
$voice.Voice=@($voice.GetVoices() | Where-Object {$_.GetDescription() -match 'Korean|Heami'})[0]
$stream=New-Object -ComObject SAPI.SpFileStream
$format=New-Object -ComObject SAPI.SpAudioFormat
$format.Type=18
$stream.Format=$format
try {
 $stream.Open((Join-Path $PSScriptRoot 'new-synthetic.wav'),3,$false)
 $voice.AudioOutputStream=$stream
 $voice.Speak('오늘 식사는 세 번 했습니다. 약을 빠뜨리지 않았습니다. 산책은 두 번 했습니다.') | Out-Null
} finally {$stream.Close()}
