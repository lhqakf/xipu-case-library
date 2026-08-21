@echo off
setlocal
cd /d "%~dp0"
echo ========================================
echo XIPU AI backend diagnostic launcher
echo Folder: %CD%
echo ========================================
set "NODE_EXE=node"
where node >nul 2>&1
if errorlevel 1 set "NODE_EXE=C:\Users\李乐乐\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
echo Node: %NODE_EXE%
if not exist "%NODE_EXE%" if "%NODE_EXE%"=="node" (
  echo ERROR: Node.js was not found in PATH.
  pause
  exit /b 1
)
"%NODE_EXE%" --version
echo Starting backend on http://localhost:4173 ...
"%NODE_EXE%" server\server.mjs
echo.
echo Backend exited with code %ERRORLEVEL%.
pause
