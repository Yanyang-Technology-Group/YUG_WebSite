param([switch]$Lan, [switch]$NoBrowser, [ValidateRange(1024,65535)][int]$Port = 5173)
$ErrorActionPreference = 'Stop'
$siteRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$dataRoot = Join-Path $siteRoot 'data'
$pidFile = Join-Path $dataRoot 'server.pid'
$nodeFile = Join-Path $siteRoot 'runtime\node.exe'
$serverFile = Join-Path $siteRoot 'server.mjs'
$baseUrl = "http://127.0.0.1:$Port"
$listenHost = if ($Lan) { '0.0.0.0' } else { '127.0.0.1' }

function Get-SiteHealth {
  try {
    $health = Invoke-RestMethod -Uri "$baseUrl/api/health" -TimeoutSec 1
    return ($health.ok -eq $true -and $health.service -in @('yanyang-government-portal', 'yunchuan-government-portal'))
  } catch { return $false }
}
function Get-OwnedProcess($record) {
  if ($null -eq $record -or $record.root -ne $siteRoot) { return $null }
  $candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$record.pid)" -ErrorAction SilentlyContinue
  if ($null -eq $candidate -or $candidate.ExecutablePath -ne $nodeFile) { return $null }
  if ($candidate.CommandLine -notmatch [regex]::Escape($serverFile)) { return $null }
  return $candidate
}

try {
  if (-not (Test-Path -LiteralPath $nodeFile -PathType Leaf)) { throw '运行环境缺失，请先完整解压部署包，再双击 start.cmd。' }
  if ((Get-FileHash -LiteralPath $nodeFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32') { throw '运行环境校验失败，请重新解压部署包。' }
  [IO.Directory]::CreateDirectory($dataRoot) | Out-Null
  $record = $null
  if (Test-Path -LiteralPath $pidFile -PathType Leaf) {
    try { $record = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json } catch { $record = $null }
  }
  $owned = Get-OwnedProcess $record
  if ($null -ne $owned) {
    if ($record.port -ne $Port -or $record.host -ne $listenHost) { throw '此部署包正在运行。请先双击 stop.cmd，再选择需要的启动方式。' }
    if (-not (Get-SiteHealth)) { throw '服务进程正在运行，但未通过健康检查，请查看 data 目录中的日志。' }
    Write-Host "网站已在运行：$baseUrl"
    if (-not $NoBrowser) { Start-Process $baseUrl }
    exit 0
  }
  if (Get-SiteHealth) { throw "端口 $Port 上已有另一份网站，请停止它或用 start.cmd -Port 5174 启动。" }
  $previousHost = $env:HOST
  $previousPort = $env:PORT
  try {
    $env:HOST = $listenHost
    $env:PORT = [string]$Port
    $serviceProcess = Start-Process -FilePath $nodeFile -ArgumentList ('"' + $serverFile + '"') -WorkingDirectory $siteRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataRoot 'server.log') -RedirectStandardError (Join-Path $dataRoot 'server-error.log') -PassThru
  } finally { $env:HOST = $previousHost; $env:PORT = $previousPort }
  $record = @{ pid = $serviceProcess.Id; root = $siteRoot; host = $listenHost; port = $Port; startedAt = [DateTime]::UtcNow.ToString('o') }
  $record | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding UTF8
  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    $serviceProcess.Refresh()
    if ($serviceProcess.HasExited) { break }
    if (Get-SiteHealth) { $ready = $true; break }
    Start-Sleep -Milliseconds 250
  }
  if (-not $ready) {
    $stillOwned = Get-OwnedProcess $record
    if ($null -ne $stillOwned) { Stop-Process -Id $record.pid -Force }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    throw "启动失败，端口可能被占用。请查看 data\server-error.log，或使用 start.cmd -Port 5174。"
  }
  Write-Host "网站已启动：$baseUrl"
  Write-Host "管理模式：$baseUrl/admin.html（首次访问设置管理员密码）"
  if ($Lan) {
    Write-Host '局域网模式已启动。另一台电脑可通过本机局域网 IPv4 地址访问；必要时由你允许 Windows 防火墙的专用网络访问。'
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { Write-Host "局域网地址：http://$($_.IPAddress):$Port" }
  }
  if (-not $NoBrowser) { Start-Process $baseUrl }
  exit 0
} catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }
