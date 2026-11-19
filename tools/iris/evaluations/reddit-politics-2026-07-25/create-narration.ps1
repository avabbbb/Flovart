param(
    [string]$TextPath = (Join-Path $PSScriptRoot 'narration.zh-CN.txt'),
    [string]$OutputPath = (Join-Path $PSScriptRoot 'narration.zh-CN.wav'),
    [double]$TargetMaxSec = 57.5
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

$text = (Get-Content -Raw -LiteralPath $TextPath).Trim()
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice = $synth.GetInstalledVoices() |
    Where-Object { $_.VoiceInfo.Culture.Name -eq 'zh-CN' } |
    Select-Object -First 1
if (-not $voice) {
    throw 'No zh-CN System.Speech voice is installed.'
}
$synth.SelectVoice($voice.VoiceInfo.Name)

$selected = $null
foreach ($rate in 0..5) {
    $candidate = Join-Path $PSScriptRoot "narration-rate-$rate.wav"
    $synth.Rate = $rate
    $synth.SetOutputToWaveFile($candidate)
    $synth.Speak($text)
    $synth.SetOutputToNull()
    $duration = [double](& ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $candidate)
    if ($duration -le $TargetMaxSec) {
        $selected = [pscustomobject]@{ rate = $rate; durationSec = $duration; path = $candidate }
        break
    }
}
$synth.Dispose()

if (-not $selected) {
    throw "Narration is still longer than $TargetMaxSec seconds at the maximum tested speech rate."
}

Copy-Item -LiteralPath $selected.path -Destination $OutputPath -Force
Get-ChildItem -LiteralPath $PSScriptRoot -Filter 'narration-rate-*.wav' |
    Where-Object { $_.FullName -ne $OutputPath } |
    Remove-Item -Force

$metadata = [ordered]@{
    generatedAt = [DateTimeOffset]::UtcNow.ToString('o')
    engine = 'Windows System.Speech'
    voice = $voice.VoiceInfo.Name
    culture = $voice.VoiceInfo.Culture.Name
    rate = $selected.rate
    durationSec = [Math]::Round($selected.durationSec, 3)
    source = [System.IO.Path]::GetFileName($TextPath)
}
$metadata | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'narration.metadata.json') -Encoding utf8
$metadata | ConvertTo-Json -Depth 4
