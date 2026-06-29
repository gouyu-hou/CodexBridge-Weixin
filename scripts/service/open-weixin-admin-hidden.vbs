Option Explicit

Dim shell, fso, scriptDir, rootDir, defaultCwd, stateDir, psScript, command

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
rootDir = fso.GetParentFolderName(fso.GetParentFolderName(scriptDir))
defaultCwd = fso.GetParentFolderName(rootDir)
stateDir = fso.BuildPath(defaultCwd, "CodexBridgeData")
psScript = fso.BuildPath(scriptDir, "open-weixin-admin.ps1")

command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Quote(psScript) & _
  " -RootDir " & Quote(rootDir) & _
  " -StateDir " & Quote(stateDir) & _
  " -DefaultCwd " & Quote(defaultCwd)

shell.Run command, 0, False

Function Quote(value)
  Quote = Chr(34) & value & Chr(34)
End Function
