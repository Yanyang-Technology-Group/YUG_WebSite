$ErrorActionPreference = 'Stop'
$siteRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$pidFile = Join-Path $siteRoot 'data\server.pid'
$nodeFile = Join-Path $siteRoot 'runtime\node.exe'
$serverFile = Join-Path $siteRoot 'server.mjs'
try {
  if (-not (Test-Path -LiteralPath $pidFile -PathType Leaf)) { Write-Host '此部署包没有运行记录。'; exit 0 }
  $record = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
  if ($record.root -ne $siteRoot) { throw '运行记录不属于此部署包，已取消停止。' }
  $candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$record.pid)" -ErrorAction SilentlyContinue
  if ($null -ne $candidate) {
    if ($candidate.ExecutablePath -ne $nodeFile -or $candidate.CommandLine -notmatch [regex]::Escape($serverFile)) { throw '进程不属于此部署包，已取消停止。' }
    Stop-Process -Id $record.pid -Force
  }
  Remove-Item -LiteralPath $pidFile -Force
  Write-Host '网站服务已停止，文章与账号数据已保留。'
  exit 0
} catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }
