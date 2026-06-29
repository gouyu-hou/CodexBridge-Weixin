param(
  [string]$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$ShortcutName = "CodexBridge Weixin Admin.lnk",
  [switch]$NoDesktopShortcut
)

$ErrorActionPreference = "Stop"

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

$RootDir = (Resolve-Path $RootDir).Path
$WScriptExe = Resolve-WScriptExe
$DefaultIcon = Join-Path $RootDir "assets\windows\codexbridge-weixin.ico"
$HiddenLauncherScript = Join-Path $RootDir "scripts\service\open-weixin-admin-electron-hidden.vbs"
$ElectronExe = Join-Path $RootDir "node_modules\electron\dist\electron.exe"
$MainScript = Join-Path $RootDir "scripts\electron\weixin-admin-main.cjs"

if (-not (Test-Path $HiddenLauncherScript)) {
  throw "Hidden Electron launcher script not found: $HiddenLauncherScript"
}
if (-not (Test-Path $MainScript)) {
  throw "Electron main script not found: $MainScript"
}
if (-not (Test-Path $ElectronExe)) {
  throw "Electron executable not found: $ElectronExe. Run npm install first."
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
  $Shortcut.Description = "Open CodexBridge Weixin as a desktop app"
  $Shortcut.Save()
  Write-Host "Desktop shortcut: $ShortcutPath"
}

Write-Host "Electron launcher installed."
