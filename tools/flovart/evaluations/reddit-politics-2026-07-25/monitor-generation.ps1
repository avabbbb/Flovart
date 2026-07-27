param(
    [string]$ReceiptPath = (Join-Path $PSScriptRoot 'receipts.json'),
    [int]$TimeoutSec = 50,
    [string]$OutputPath = (Join-Path $PSScriptRoot 'tasks.final.json')
)

$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\..'))
$cliPath = Join-Path $repoRoot 'tools\flovart\cli.js'
$receipt = Get-Content -Raw -LiteralPath $ReceiptPath | ConvertFrom-Json
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$last = @{}
$tasks = @()

do {
    $tasks = foreach ($entry in $receipt.receipts) {
        $response = (& node $cliPath task.get --task-id $entry.taskId --json) | ConvertFrom-Json
        if (-not $response.ok) {
            throw "task.get failed for $($entry.taskId): $($response.error.message)"
        }
        $task = $response.data
        $state = "$($task.status)|$($task.progress.phase)"
        if ($last[$task.id] -ne $state) {
            [pscustomobject]@{
                slot = $entry.slot
                taskId = $task.id
                status = $task.status
                phase = $task.progress.phase
                routeId = $task.progress.routeId
                priceQuote = $task.progress.priceQuote
            } | ConvertTo-Json -Depth 5 -Compress | Write-Host
            $last[$task.id] = $state
        }
        [ordered]@{
            slot = $entry.slot
            kind = $entry.kind
            taskId = $task.id
            status = $task.status
            progress = $task.progress
            result = $task.result
            error = $task.error
        }
    }
    if (-not ($tasks.status | Where-Object { $_ -notin @('completed', 'failed', 'cancelled', 'input_required') })) {
        break
    }
    Start-Sleep -Seconds 4
} while ((Get-Date) -lt $deadline)

[ordered]@{
    checkedAt = [DateTimeOffset]::UtcNow.ToString('o')
    terminal = -not ($tasks.status | Where-Object { $_ -notin @('completed', 'failed', 'cancelled', 'input_required') })
    tasks = $tasks
} | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $OutputPath -Encoding utf8
