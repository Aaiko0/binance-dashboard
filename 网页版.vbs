Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

basePath = fso.GetParentFolderName(WScript.ScriptFullName)
nodePath = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"

If Not fso.FileExists(nodePath) Then
  nodePath = "node"
End If

command = """" & nodePath & """ """ & basePath & "\scripts\open-web-panel.js"""
shell.Run command, 0, False
