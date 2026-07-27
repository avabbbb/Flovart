param(
    [string]$TaskPath = (Join-Path $PSScriptRoot 'tasks.final.json'),
    [string]$OutputPath = (Join-Path $PSScriptRoot 'reddit-politics-one-empty-chair.mp4')
)

$ErrorActionPreference = 'Stop'
$appDataRoot = Join-Path $env:APPDATA 'com.flovart.desktop'
$taskState = Get-Content -Raw -LiteralPath $TaskPath | ConvertFrom-Json
if (-not $taskState.terminal) {
    throw 'Generation tasks are not terminal. Run monitor-generation.ps1 again.'
}
$failed = @($taskState.tasks | Where-Object status -ne 'completed')
if ($failed.Count -gt 0) {
    throw "Cannot render: $($failed.Count) generation task(s) did not complete."
}

$taskBySlot = @{}
foreach ($task in $taskState.tasks) {
    $taskBySlot[$task.slot] = $task
}

function Resolve-ArtifactPath {
    param([object]$Task)
    $path = Join-Path $appDataRoot $Task.result.artifact.storeRelpath
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Artifact not found: $path"
    }
    return $path
}

$shots = @(
    [pscustomobject]@{ slot = 'visual-01'; kind = 'video'; path = (Join-Path $appDataRoot 'runtime-artifacts\videos\task_019f9519-02e3-7b21-bd3e-86479e0686a6.mp4'); taskId = 'task_019f9519-02e3-7b21-bd3e-86479e0686a6' },
    [pscustomobject]@{ slot = 'visual-02'; kind = 'image'; path = (Join-Path $appDataRoot 'runtime-artifacts\images\task_019f9511-f256-70b3-ad30-44076635079c.png'); taskId = 'task_019f9511-f256-70b3-ad30-44076635079c' },
    [pscustomobject]@{ slot = 'visual-03'; kind = 'video'; path = (Resolve-ArtifactPath $taskBySlot['visual-03']); taskId = $taskBySlot['visual-03'].taskId },
    [pscustomobject]@{ slot = 'visual-04'; kind = 'image'; path = (Resolve-ArtifactPath $taskBySlot['visual-04']); taskId = $taskBySlot['visual-04'].taskId },
    [pscustomobject]@{ slot = 'visual-05'; kind = 'video'; path = (Resolve-ArtifactPath $taskBySlot['visual-05']); taskId = $taskBySlot['visual-05'].taskId },
    [pscustomobject]@{ slot = 'visual-06'; kind = 'image'; path = (Resolve-ArtifactPath $taskBySlot['visual-06']); taskId = $taskBySlot['visual-06'].taskId },
    [pscustomobject]@{ slot = 'visual-07'; kind = 'video'; path = (Resolve-ArtifactPath $taskBySlot['visual-07']); taskId = $taskBySlot['visual-07'].taskId },
    [pscustomobject]@{ slot = 'visual-08'; kind = 'image'; path = (Resolve-ArtifactPath $taskBySlot['visual-08']); taskId = $taskBySlot['visual-08'].taskId },
    [pscustomobject]@{ slot = 'visual-09'; kind = 'video'; path = (Resolve-ArtifactPath $taskBySlot['visual-09']); taskId = $taskBySlot['visual-09'].taskId },
    [pscustomobject]@{ slot = 'visual-10'; kind = 'image'; path = (Resolve-ArtifactPath $taskBySlot['visual-10']); taskId = $taskBySlot['visual-10'].taskId }
)
foreach ($shot in $shots) {
    if (-not (Test-Path -LiteralPath $shot.path)) {
        throw "Shot artifact not found: $($shot.path)"
    }
}

$ffmpegArgs = @('-hide_banner', '-loglevel', 'warning', '-y')
foreach ($shot in $shots) {
    if ($shot.kind -eq 'image') {
        $ffmpegArgs += @('-loop', '1', '-t', '6', '-i', $shot.path)
    } else {
        $ffmpegArgs += @('-i', $shot.path)
    }
}
$ffmpegArgs += @('-i', (Join-Path $PSScriptRoot 'narration.zh-CN.wav'))

$filters = @()
for ($index = 0; $index -lt $shots.Count; $index++) {
    if ($shots[$index].kind -eq 'image') {
        $filters += "[$index`:v]scale=1344:756:force_original_aspect_ratio=increase,crop=1280:720,zoompan=z='min(zoom+0.00045,1.035)':d=144:s=1280x720:fps=24,trim=duration=6,setpts=PTS-STARTPTS[v$index]"
    } else {
        $filters += "[$index`:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,fps=24,trim=duration=6,setpts=PTS-STARTPTS[v$index]"
    }
}
$concatInputs = (0..9 | ForEach-Object { "[v$_]" }) -join ''
$filters += "$concatInputs`concat=n=10:v=1:a=0[base]"
$subtitlePath = (Join-Path $PSScriptRoot 'captions.zh-CN.srt').Replace('\', '/').Replace(':', '\:')
$filters += "[base]subtitles='$subtitlePath':force_style='FontName=Microsoft YaHei,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,Outline=1,Shadow=0,MarginV=32,Alignment=2'[video]"
$filterComplex = $filters -join ';'

$ffmpegArgs += @(
    '-filter_complex', $filterComplex,
    '-map', '[video]',
    '-map', '10:a:0',
    '-t', '60',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-af', 'apad=pad_dur=60,alimiter=limit=0.95',
    '-movflags', '+faststart',
    $OutputPath
)

& ffmpeg @ffmpegArgs
if ($LASTEXITCODE -ne 0) {
    throw "ffmpeg failed with exit code $LASTEXITCODE."
}

$probe = (& ffprobe -v error -show_entries format=duration,size -show_entries stream=index,codec_type,codec_name,width,height,r_frame_rate -of json $OutputPath) | ConvertFrom-Json
$sha = (Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash.ToLowerInvariant()
$verification = [ordered]@{
    renderedAt = [DateTimeOffset]::UtcNow.ToString('o')
    output = [System.IO.Path]::GetFileName($OutputPath)
    sha256 = $sha
    durationSec = [Math]::Round([double]$probe.format.duration, 3)
    byteSize = [long]$probe.format.size
    streams = $probe.streams
    sourceTasks = @($shots | ForEach-Object { [ordered]@{ slot = $_.slot; taskId = $_.taskId } })
    generatedAudioDiscarded = $true
    narration = 'narration.zh-CN.wav'
    captions = 'captions.zh-CN.srt'
}
$verification | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'film-verification.json') -Encoding utf8
$verification | ConvertTo-Json -Depth 8
