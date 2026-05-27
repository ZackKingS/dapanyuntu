@echo off
echo 正在重启 Node 服务器...
taskkill /F /IM node.exe 2>nul
timeout /t 2 /nobreak
echo.
echo 启动服务器...
cd /d %~dp0
node server.js
pause
