@echo off
rem Makes a backup of Pocket Ledger now.
cd /d "%~dp0..\.."
call npm run backup
echo.
pause
