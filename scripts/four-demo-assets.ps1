$ErrorActionPreference='Stop'
Set-Location (Join-Path $PSScriptRoot '..')
New-Item -ItemType Directory -Force .runtime | Out-Null
$voice=New-Object -ComObject SAPI.SpVoice
$voice.Voice=@($voice.GetVoices() | Where-Object {$_.GetDescription() -match 'Korean|Heami'})[0]
$texts=@('합성 상담입니다. 오늘 식사는 세 번 했습니다. 약을 빠뜨리지 않았습니다. 산책은 일주일에 두 번 했습니다.','합성 상담입니다. 오늘 식사는 두 번 했습니다. 외출은 일주일에 한 번 했습니다.')
for($i=0;$i -lt 2;$i++){
 $stream=New-Object -ComObject SAPI.SpFileStream
 $format=New-Object -ComObject SAPI.SpAudioFormat
 $format.Type=18
 $stream.Format=$format
 try{$stream.Open((Join-Path (Get-Location) ".runtime/person-$i.wav"),3,$false);$voice.AudioOutputStream=$stream;$voice.Speak($texts[$i]) | Out-Null}finally{$stream.Close()}
}
