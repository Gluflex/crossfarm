@echo off
rem Starts the local server (if not running) and opens the phone preview.
cd /d "%~dp0"
curl -s -o nul http://127.0.0.1:8771/ || start "Crossfarm Server" /min python -m http.server 8771 --bind 127.0.0.1
timeout /t 1 /nobreak >nul
start "" http://127.0.0.1:8771/
