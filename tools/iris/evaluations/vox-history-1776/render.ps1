param(
    [Parameter(Mandatory = $true)]
    [string[]]$ClipPaths,
    [string]$OutputPath = (Join-Path $PSScriptRoot 'vox-history-1776.mp4')
)

$ErrorActionPreference = 'Stop'
if ($ClipPaths.Count -ne 4) {
    throw 'Exactly four Veo clips are required.'
}
foreach ($clip in $ClipPaths) {
    if (-not (Test-Path -LiteralPath $clip -PathType Leaf)) {
        throw "Missing Veo clip: $clip"
    }

    $probe = ffprobe -v error -show_entries stream=codec_type -of json $clip | ConvertFrom-Json
    if (-not ($probe.streams | Where-Object codec_type -eq 'video')) {
        throw "Clip has no video stream: $clip"
    }
    if (-not ($probe.streams | Where-Object codec_type -eq 'audio')) {
        throw "Clip has no audio stream: $clip"
    }
}

$narration = Join-Path $PSScriptRoot 'narration.zh-CN.wav'
$captions = Join-Path $PSScriptRoot 'captions.zh-CN.srt'
$subtitlePath = $captions.Replace('\', '/').Replace(':', '\:')
$filter = @"
[0:v]fps=24,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,drawbox=x=0:y=0:w=190:h=105:color=0xEAD8B7@0.96:t=fill,drawbox=x=0:y=100:w=190:h=5:color=0xA13C2F@0.95:t=fill[v0];
[1:v]fps=24,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v1];
[2:v]fps=24,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v2];
[3:v]fps=24,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v3];
[0:a]aresample=48000[a0];[1:a]aresample=48000[a1];[2:a]aresample=48000[a2];[3:a]aresample=48000[a3];
[v0][a0][v1][a1][v2][a2][v3][a3]concat=n=4:v=1:a=1[video][bed];
[video]subtitles='$subtitlePath':force_style='FontName=Microsoft YaHei,FontSize=21,PrimaryColour=&H00FFFFFF,OutlineColour=&H00151515,BorderStyle=1,Outline=2,Shadow=0,MarginV=38,Alignment=2'[captioned];
[bed]volume=0.08[quietbed];
[4:a]aresample=48000,adelay=300|300,volume=1.0[voice];
[quietbed][voice]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[audio]
"@

$ffmpegArgs = @(
    '-y'
)
foreach ($clip in $ClipPaths) {
    $ffmpegArgs += @('-i', $clip)
}
$ffmpegArgs += @(
    '-i', $narration,
    '-filter_complex', $filter,
    '-map', '[captioned]',
    '-map', '[audio]',
    '-t', '30',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '48000',
    '-movflags', '+faststart',
    $OutputPath
)

& ffmpeg @ffmpegArgs
if ($LASTEXITCODE -ne 0) {
    throw "ffmpeg failed with exit code $LASTEXITCODE"
}

$reportPath = [System.IO.Path]::ChangeExtension($OutputPath, '.verify.json')
$report = ffprobe -v error -show_entries format=duration,format_name:stream=index,codec_name,codec_type,width,height,sample_rate,channels -of json $OutputPath | ConvertFrom-Json
$duration = [double]$report.format.duration
$video = $report.streams | Where-Object codec_type -eq 'video' | Select-Object -First 1
$audio = $report.streams | Where-Object codec_type -eq 'audio' | Select-Object -First 1
$checks = [ordered]@{
    duration = $duration -ge 29.9 -and $duration -le 30.1
    video = $null -ne $video
    audio = $null -ne $audio
    resolution = $video.width -eq 1280 -and $video.height -eq 720
    videoCodec = $video.codec_name -eq 'h264'
    audioCodec = $audio.codec_name -eq 'aac'
}
$verification = [ordered]@{
    passed = -not ($checks.Values -contains $false)
    outputPath = $OutputPath
    checkedAt = [DateTimeOffset]::UtcNow.ToString('o')
    checks = $checks
    media = $report
}
$verification | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding utf8
if (-not $verification.passed) {
    throw "Media verification failed. See $reportPath"
}

$verification
