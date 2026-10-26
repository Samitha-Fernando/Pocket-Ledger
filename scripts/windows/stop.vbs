' Stops Pocket Ledger. (Used by the Start menu shortcut.)
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)))
sh.Run "cmd /c npm run app:stop >> data\launcher.log 2>&1", 0, True
MsgBox "Pocket Ledger has stopped.", vbInformation, "Pocket Ledger"
