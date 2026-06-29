param(
  [string]$TaskName = "CodexBridge-Weixin",
  [string]$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$StateDir = "",
  [string]$HomeDir = "",
  [string]$DefaultCwd = "",
  [string]$AdminUrl = "",
  [string]$EnvFile = "",
  [int]$TimeoutSeconds = 90,
  [switch]$NoOpen,
  [switch]$NoStartBridge,
  [switch]$NoShutdownOnClose
)

$ErrorActionPreference = "Stop"

function Resolve-DefaultEnvFile {
  return (Join-Path $RootDir "weixin.service.env")
}

function Find-CommandPath([string[]]$Names) {
  foreach ($Name in $Names) {
    $Command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($Command) {
      return $Command.Source
    }
  }
  return ""
}

function Quote-WindowsArgument([string]$Value) {
  return "`"$Value`""
}

function Resolve-ServiceHomeDir([string]$RequestedHomeDir, [string]$ResolvedRootDir) {
  if ($RequestedHomeDir) {
    $Resolved = Resolve-Path $RequestedHomeDir -ErrorAction SilentlyContinue
    if ($Resolved) {
      return $Resolved.Path
    }
    return $RequestedHomeDir
  }
  if ($env:USERPROFILE) {
    return $env:USERPROFILE
  }
  $RootMatch = [regex]::Match($ResolvedRootDir, "^[A-Za-z]:\\Users\\[^\\]+")
  if ($RootMatch.Success) {
    return $RootMatch.Value
  }
  return $HOME
}

function Resolve-ServiceAppData([string]$ResolvedHomeDir) {
  if ($env:APPDATA -and $env:APPDATA -notlike "*\systemprofile\*") {
    return $env:APPDATA
  }
  return Join-Path $ResolvedHomeDir "AppData\Roaming"
}

function Resolve-DefaultStateDir([string]$ResolvedRootDir, [string]$ResolvedHomeDir) {
  $ProjectParent = Split-Path -Parent $ResolvedRootDir
  $SiblingData = Join-Path $ProjectParent "CodexBridgeData"
  if (Test-Path $SiblingData) {
    return $SiblingData
  }
  return Join-Path $ResolvedHomeDir ".codexbridge"
}

function Read-ServiceEnv([string]$Path) {
  $Values = @{}
  if (-not $Path -or -not (Test-Path $Path)) {
    return $Values
  }
  foreach ($RawLine in Get-Content -Path $Path -Encoding UTF8) {
    $Line = $RawLine.Trim()
    if (-not $Line -or $Line.StartsWith("#")) {
      continue
    }
    $Index = $Line.IndexOf("=")
    if ($Index -le 0) {
      continue
    }
    $Key = $Line.Substring(0, $Index).Trim()
    $Value = $Line.Substring($Index + 1).Trim()
    if ($Value.Length -ge 2) {
      if (($Value.StartsWith('"') -and $Value.EndsWith('"')) -or ($Value.StartsWith("'") -and $Value.EndsWith("'"))) {
        $Value = $Value.Substring(1, $Value.Length - 2)
      }
    }
    $Values[$Key] = $Value
  }
  return $Values
}

function Resolve-AdminUrl([string]$RequestedUrl, [hashtable]$ServiceEnv) {
  if ($RequestedUrl) {
    return $RequestedUrl.TrimEnd("/")
  }
  $HostName = "127.0.0.1"
  $Port = "43183"
  if ($ServiceEnv.ContainsKey("WEIXIN_ADMIN_HOST") -and $ServiceEnv["WEIXIN_ADMIN_HOST"]) {
    $HostName = $ServiceEnv["WEIXIN_ADMIN_HOST"]
  }
  if ($ServiceEnv.ContainsKey("WEIXIN_ADMIN_PORT") -and $ServiceEnv["WEIXIN_ADMIN_PORT"]) {
    $Port = $ServiceEnv["WEIXIN_ADMIN_PORT"]
  }
  return "http://${HostName}:${Port}"
}

function Add-QueryParameter([string]$Url, [string]$Name, [string]$Value) {
  if ($Url -match "(\?|&)$([regex]::Escape($Name))=") {
    return $Url
  }
  $Separator = "?"
  if ($Url.Contains("?")) {
    $Separator = "&"
  }
  return "${Url}${Separator}${Name}=${Value}"
}

function Start-BridgeTask([string]$Name) {
  $Task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
  if ($Task -and $Task.State -eq "Running") {
    return
  }
  Start-BridgeHidden
}

function Start-BridgeHidden {
  $NodeBin = Find-CommandPath @("node.exe", "node")
  if (-not $NodeBin) {
    throw "node was not found in PATH"
  }
  $WScriptBin = Find-CommandPath @("wscript.exe", "wscript")
  if (-not $WScriptBin) {
    throw "wscript was not found in PATH"
  }
  $Runner = Join-Path $RootDir "scripts\service\run-weixin-service.mjs"
  $HiddenRunner = Join-Path $RootDir "scripts\service\run-weixin-service-hidden.vbs"
  if (-not (Test-Path $Runner)) {
    throw "Service runner not found: $Runner"
  }
  if (-not (Test-Path $HiddenRunner)) {
    throw "Hidden service runner not found: $HiddenRunner"
  }
  if (-not $StateDir) {
    $StateDir = Resolve-DefaultStateDir $RootDir $HomeDir
  }
  if (-not $EnvFile) {
    $EnvFile = Resolve-DefaultEnvFile
  }
  $LogDir = Join-Path $StateDir "logs"
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  $StdoutLog = Join-Path $LogDir "weixin-bridge.out.log"
  $StderrLog = Join-Path $LogDir "weixin-bridge.err.log"
  $Args = @(
    (Quote-WindowsArgument $HiddenRunner),
    (Quote-WindowsArgument $NodeBin),
    (Quote-WindowsArgument $Runner),
    "--root-dir", (Quote-WindowsArgument $RootDir),
    "--home-dir", (Quote-WindowsArgument $HomeDir),
    "--state-dir", (Quote-WindowsArgument $StateDir),
    "--env-file", (Quote-WindowsArgument $EnvFile),
    "--stdout-log", (Quote-WindowsArgument $StdoutLog),
    "--stderr-log", (Quote-WindowsArgument $StderrLog)
  )
  if ($DefaultCwd) {
    $Args += @("--cwd", (Quote-WindowsArgument $DefaultCwd))
  }
  Start-Process -FilePath $WScriptBin -ArgumentList ($Args -join " ") -WindowStyle Hidden
}

function Wait-AdminState([string]$Url, [int]$TimeoutSeconds) {
  $Deadline = (Get-Date).AddSeconds([Math]::Max(5, $TimeoutSeconds))
  $LastError = $null
  while ((Get-Date) -lt $Deadline) {
    try {
      return Invoke-RestMethod -Uri "$Url/api/state" -TimeoutSec 5
    } catch {
      $LastError = $_
      Start-Sleep -Seconds 2
    }
  }
  if ($LastError) {
    throw "Admin page did not become ready: $($LastError.Exception.Message)"
  }
  throw "Admin page did not become ready."
}

function Try-AdminState([string]$Url) {
  try {
    return Invoke-RestMethod -Uri "$Url/api/state" -TimeoutSec 2
  } catch {
    return $null
  }
}

$RootDir = (Resolve-Path $RootDir).Path
$HomeDir = Resolve-ServiceHomeDir $HomeDir $RootDir
if (-not $StateDir) {
  $StateDir = Resolve-DefaultStateDir $RootDir $HomeDir
}
if (-not $EnvFile) {
  $EnvFile = Resolve-DefaultEnvFile
}

$ServiceEnv = Read-ServiceEnv $EnvFile
$ResolvedAdminUrl = Resolve-AdminUrl $AdminUrl $ServiceEnv

$State = Try-AdminState $ResolvedAdminUrl
if (-not $State) {
  Start-BridgeTask $TaskName
  $State = Wait-AdminState $ResolvedAdminUrl $TimeoutSeconds
}

if (-not $NoStartBridge -and $State.bridge -and $State.bridge.running -eq $false) {
  Invoke-RestMethod -Method Post -Uri "$ResolvedAdminUrl/api/bridge/start" -TimeoutSec 30 | Out-Null
  $State = Wait-AdminState $ResolvedAdminUrl $TimeoutSeconds
}

if (-not $NoOpen) {
  $OpenUrl = $ResolvedAdminUrl
  if (-not $NoShutdownOnClose) {
    $OpenUrl = Add-QueryParameter $OpenUrl "shutdownOnClose" "1"
  }
  Start-Process $OpenUrl
}

Write-Host "CodexBridge Weixin admin is ready: $ResolvedAdminUrl"
if ($State.primaryAccountId) {
  Write-Host "Primary account: $($State.primaryAccountId)"
}
if ($State.bridge) {
  Write-Host "Bridge running: $($State.bridge.running)"
}
