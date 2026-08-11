[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory = $true)]
  [ValidateScript({ $_ -match '^[a-p]{32}$' })]
  [string[]]$ExtensionId,

  [ValidateSet('Edge', 'Chrome', 'Both')]
  [string]$Browser = 'Edge',

  [string]$HostPath
)

$ErrorActionPreference = 'Stop'
$hostName = 'com.flovart.browser_bridge'
$workspaceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path

if (-not $HostPath) {
  $candidates = @(
    (Join-Path $workspaceRoot 'src-tauri\target\debug\flovart-host.exe'),
    (Join-Path $workspaceRoot 'src-tauri\target\release\flovart-host.exe'),
    (Join-Path $workspaceRoot 'src-tauri\binaries\flovart-host-x86_64-pc-windows-msvc.exe')
  )
  $HostPath = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}

if (-not $HostPath -or -not (Test-Path -LiteralPath $HostPath -PathType Leaf)) {
  throw '找不到 flovart-host.exe。请先运行 cargo build --bin flovart-host，或通过 -HostPath 指定。'
}

$resolvedHost = (Resolve-Path -LiteralPath $HostPath).Path
$manifestDirectory = Join-Path $env:LOCALAPPDATA 'Flovart\NativeMessagingHosts'
$manifestPath = Join-Path $manifestDirectory "$hostName.json"
$allowedOrigins = $ExtensionId | Sort-Object -Unique | ForEach-Object { "chrome-extension://$_/" }
$manifest = [ordered]@{
  name = $hostName
  description = 'Flovart Desktop Browser Import Bridge'
  path = $resolvedHost
  type = 'stdio'
  allowed_origins = @($allowedOrigins)
}

$registryPaths = switch ($Browser) {
  'Edge' { "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName" }
  'Chrome' { "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName" }
  'Both' {
    "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName"
    "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
  }
}

if ($PSCmdlet.ShouldProcess($manifestPath, '注册 Flovart Native Messaging Host')) {
  [System.IO.Directory]::CreateDirectory($manifestDirectory) | Out-Null
  $json = $manifest | ConvertTo-Json -Depth 4
  [System.IO.File]::WriteAllText($manifestPath, $json, [System.Text.UTF8Encoding]::new($false))
  foreach ($registryPath in $registryPaths) {
    New-Item -Path $registryPath -Force | Out-Null
    Set-Item -Path $registryPath -Value $manifestPath
  }
  Write-Host "Native Host 已注册：$manifestPath"
  Write-Host "允许扩展：$($allowedOrigins -join ', ')"
  Write-Host '请在 Edge/Chrome 扩展管理页重新加载 Flovart Browser Import。'
}
