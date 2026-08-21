Option Explicit
Dim fso, projectDir, servicePath, processes, process
Set fso = CreateObject("Scripting.FileSystemObject")
projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
servicePath = LCase(projectDir & "\server\server.mjs")
Set processes = GetObject("winmgmts:").ExecQuery("Select * from Win32_Process Where Name = 'node.exe'")
For Each process In processes
  If Not IsNull(process.CommandLine) Then
    If InStr(LCase(process.CommandLine), servicePath) > 0 Then process.Terminate
  End If
Next
