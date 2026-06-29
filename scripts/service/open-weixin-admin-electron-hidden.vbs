Option Explicit

Dim shell, fso, scriptDir, rootDir, electronExe, mainScript, command

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
rootDir = fso.GetParentFolderName(fso.GetParentFolderName(scriptDir))
electronExe = fso.BuildPath(rootDir, "node_modules\electron\dist\electron.exe")
mainScript = fso.BuildPath(rootDir, "scripts\electron\weixin-admin-main.cjs")

If Not fso.FileExists(electronExe) Then
  MsgBox "Electron was not found. Please run npm install in " & rootDir, vbCritical, "CodexBridge Weixin Admin"
  WScript.Quit 1
End If

command = Quote(electronExe) & " " & Quote(mainScript)
shell.Run command, 1, False

Function Quote(value)
  Quote = Chr(34) & value & Chr(34)
End Function
