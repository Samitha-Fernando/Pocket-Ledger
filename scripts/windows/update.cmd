@echo off
rem Updates Pocket Ledger after new features (backs up first). Shows progress.
cd /d "%~dp0..\.."
echo Updating Pocket Ledger. Your data is backed up first.
echo.
call npm run app:update
echo.
pause
