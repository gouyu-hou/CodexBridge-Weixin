Option Explicit

Dim shell, command

Set shell = CreateObject("WScript.Shell")

command = Quote(WScript.Arguments(0))

Dim i
For i = 1 To WScript.Arguments.Count - 1
  command = command & " " & Quote(WScript.Arguments(i))
Next

shell.Run command, 0, False

Function Quote(value)
  Quote = Chr(34) & value & Chr(34)
End Function
