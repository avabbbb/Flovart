param(
    [string]$PlanPath = (Join-Path $PSScriptRoot 'generation-plan.json'),
    [string]$ReceiptPath = (Join-Path $PSScriptRoot 'receipts.json')
)

$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\..'))
$cliPath = Join-Path $repoRoot 'tools\flovart\cli.js'
$plan = Get-Content -Raw -LiteralPath $PlanPath | ConvertFrom-Json
$receipts = @()

foreach ($item in $plan.items) {
    if ($item.kind -eq 'image') {
        $args = @(
            $cliPath, 'generate.image',
            '--provider', 'runningHub',
            '--product-model', 'flovart:gpt-image-2',
            '--prompt', $item.prompt,
            '--aspect-ratio', '16:9',
            '--resolution', '1k',
            '--idempotency-key', $item.idempotencyKey,
            '--json'
        )
    } else {
        $args = @(
            $cliPath, 'generate.video',
            '--provider', 'runningHub',
            '--product-model', 'flovart:grok-imagine-video-1.5',
            '--prompt', $item.prompt,
            '--duration-sec', '6',
            '--aspect-ratio', '16:9',
            '--resolution', '720p',
            '--generate-audio', 'false',
            '--idempotency-key', $item.idempotencyKey,
            '--json'
        )
    }

    $response = (& node @args) | ConvertFrom-Json
    if (-not $response.ok) {
        throw "Submission failed for $($item.slot): $($response.error.message)"
    }
    $receipts += [ordered]@{
        slot = $item.slot
        kind = $item.kind
        idempotencyKey = $item.idempotencyKey
        taskId = $response.data.taskId
        commandId = $response.data.commandId
        status = $response.data.status
    }
}

[ordered]@{
    submittedAt = [DateTimeOffset]::UtcNow.ToString('o')
    receipts = $receipts
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ReceiptPath -Encoding utf8

Get-Content -Raw -LiteralPath $ReceiptPath
