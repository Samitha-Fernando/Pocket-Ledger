' Starts Pocket Ledger with no console window and opens it. (Used by the desktop icon.)
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)))
If Not fso.FolderExists("data") Then fso.CreateFolder("data")
sh.Run "cmd /c npm run app:start >> data\launcher.log 2>&1", 0, False
