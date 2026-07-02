param(
  [string]$Output
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$source = Join-Path $PSScriptRoot 'FlovartLauncher.cs'
if (-not $Output) { $Output = Join-Path $root 'FlovartLauncher.exe' }

Add-Type `
  -TypeDefinition ([IO.File]::ReadAllText($source, [Text.Encoding]::UTF8)) `
  -ReferencedAssemblies 'System.Windows.Forms','System.Drawing' `
  -OutputAssembly $Output `
  -OutputType WindowsApplication

Write-Host "FlovartLauncher.exe 已生成：$Output"