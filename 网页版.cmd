@echo off
setlocal
cd /d "%~dp0"

set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if exist "%NODE_EXE%" (
  "%NODE_EXE%" "%~dp0scripts\open-web-panel.js"
) else (
  node "%~dp0scripts\open-web-panel.js"
)
