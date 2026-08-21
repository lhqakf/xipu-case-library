Option Explicit
Dim shell, fso, projectDir, nodeExe, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
nodeExe = "C:\Users\李乐乐\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
If Not fso.FileExists(nodeExe) Then nodeExe = "node"
shell.CurrentDirectory = projectDir
command = Chr(34) & nodeExe & Chr(34) & " " & Chr(34) & projectDir & "\server\server.mjs" & Chr(34)
shell.Run command, 0, False
WScript.Sleep 1800
shell.Run "http://localhost:4173", 1, False
