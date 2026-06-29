param(
  [string]$TaskName = "CodexBridge-Weixin",
  [string]$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$AdminUrl = "",
  [string]$EnvFile = "",
  [string]$ShortcutName = "CodexBridge Weixin Admin.lnk",
  [switch]$NoDesktopShortcut
)

$ErrorActionPreference = "Stop"

function Resolve-PowerShellExe {
  $WindowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  if (Test-Path $WindowsPowerShell) {
    return $WindowsPowerShell
  }
  $Command = Get-Command powershell.exe -ErrorAction SilentlyContinue
  if ($Command) {
    return $Command.Source
  }
  throw "powershell.exe was not found"
}

function Resolve-WScriptExe {
  $WScript = Join-Path $env:SystemRoot "System32\wscript.exe"
  if (Test-Path $WScript) {
    return $WScript
  }
  $Command = Get-Command wscript.exe -ErrorAction SilentlyContinue
  if ($Command) {
    return $Command.Source
  }
  throw "wscript.exe was not found"
}

function Build-LauncherArguments([string]$ScriptPath, [string]$TaskName, [string]$AdminUrl, [string]$EnvFile) {
  $Args = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-WindowStyle", "Hidden",
    "-File", "`"$ScriptPath`"",
    "-TaskName", "`"$TaskName`""
  )
  if ($AdminUrl) {
    $Args += @("-AdminUrl", "`"$AdminUrl`"")
  }
  if ($EnvFile) {
    $Args += @("-EnvFile", "`"$EnvFile`"")
  }
  return $Args
}

$PowerShellExe = Resolve-PowerShellExe
$WScriptExe = Resolve-WScriptExe
$DefaultIcon = Join-Path $RootDir "assets\windows\codexbridge-weixin.ico"
$LauncherScript = Join-Path $RootDir "scripts\service\open-weixin-admin.ps1"
if (-not (Test-Path $LauncherScript)) {
  throw "Launcher script not found: $LauncherScript"
}
$HiddenLauncherScript = Join-Path $RootDir "scripts\service\open-weixin-admin-hidden.vbs"
if (-not (Test-Path $HiddenLauncherScript)) {
  throw "Hidden launcher script not found: $HiddenLauncherScript"
}

if (-not $NoDesktopShortcut) {
  $Desktop = [Environment]::GetFolderPath("Desktop")
  $ShortcutPath = Join-Path $Desktop $ShortcutName
  $Shell = New-Object -ComObject WScript.Shell
  $Shortcut = $Shell.CreateShortcut($ShortcutPath)
  $Shortcut.TargetPath = $WScriptExe
  $Shortcut.Arguments = "`"$HiddenLauncherScript`""
  $Shortcut.WorkingDirectory = $RootDir
  if (Test-Path $DefaultIcon) {
    $Shortcut.IconLocation = $DefaultIcon
  } else {
    $Shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,220"
  }
  $Shortcut.Description = "Start CodexBridge Weixin service and open the local admin panel"
  $Shortcut.Save()
  Write-Host "Desktop shortcut: $ShortcutPath"
}

Write-Host "Launcher installed (desktop shortcut only)."
