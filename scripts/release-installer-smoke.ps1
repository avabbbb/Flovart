param(
  [string]$Artifact
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Artifact)) {
  $Artifact = Join-Path $PSScriptRoot '..\src-tauri\target\release\bundle\nsis\Iris_0.3.2_x64-setup.exe'
}
$artifact = (Resolve-Path -LiteralPath $Artifact).Path
$artifactItem = Get-Item -LiteralPath $artifact
$artifactHash = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash
$installRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('iris-rc-installer-' + [guid]::NewGuid().ToString('N'))

New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
$installer = Start-Process -FilePath $artifact -ArgumentList @('/S', "/D=$installRoot") -Wait -PassThru
$installedExes = @(Get-ChildItem -LiteralPath $installRoot -Recurse -File -Filter '*.exe' -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notin @('uninstall.exe', 'Uninstall.exe') })
$installedExe = $installedExes |
  Where-Object { $_.BaseName -ieq 'iris' } |
  Select-Object -First 1
if ($null -eq $installedExe) {
  $installedExe = $installedExes | Select-Object -First 1
}

$app = $null
$launchObserved = $false
$launchPath = $null
$closeMode = $null
if ($null -ne $installedExe) {
  $app = Start-Process -FilePath $installedExe.FullName -PassThru
  Start-Sleep -Seconds 8
  $running = Get-CimInstance Win32_Process -Filter "ProcessId = $($app.Id)" -ErrorAction SilentlyContinue
  if ($null -ne $running) {
    $launchObserved = $true
    $launchPath = $running.ExecutablePath
  }
  if (-not $app.HasExited) {
    [void]$app.CloseMainWindow()
    if ($app.WaitForExit(10000)) {
      $closeMode = 'graceful'
    } else {
      $app.Kill()
      [void]$app.WaitForExit(5000)
      $closeMode = 'exact-app-pid-kill'
    }
  } else {
    $closeMode = 'already-exited'
  }
}

$uninstaller = Get-ChildItem -LiteralPath $installRoot -Recurse -File -Filter 'uninstall.exe' -ErrorAction SilentlyContinue |
  Select-Object -First 1
$uninstall = $null
if ($null -ne $uninstaller) {
  $uninstall = Start-Process -FilePath $uninstaller.FullName -ArgumentList @('/S') -Wait -PassThru
}
Start-Sleep -Seconds 2
$stillThere = Test-Path -LiteralPath $installRoot
$result = [ordered]@{
  artifact = $artifact
  bytes = $artifactItem.Length
  sha256 = $artifactHash
  installRoot = $installRoot
  installExit = $installer.ExitCode
  installedExe = if ($null -ne $installedExe) { $installedExe.FullName } else { $null }
  launchObserved = $launchObserved
  launchPath = $launchPath
  closeMode = $closeMode
  uninstallExit = if ($null -ne $uninstall) { $uninstall.ExitCode } else { $null }
  installRootExistsAfterUninstall = $stillThere
}
$result | ConvertTo-Json -Compress

if ($stillThere) {
  Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction SilentlyContinue
}
if ($installer.ExitCode -ne 0 -or $null -eq $installedExe -or -not $launchObserved -or $null -eq $uninstall -or $uninstall.ExitCode -ne 0 -or $stillThere) {
  exit 1
}
