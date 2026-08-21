@echo off
setlocal
cd /d "%~dp0"
echo Starting XIPU AI backend on http://localhost:8787
node --env-file=.env server\server.mjs
echo.
pause
