@echo off
setlocal enabledelayedexpansion
title VideoInputMonitor - Local Server

cd /d "%~dp0"

set PORT=8000

echo ============================================
echo   VideoInputMonitor
echo ============================================
echo.

where python >nul 2>nul
if %errorlevel%==0 (
    set PYCMD=python
) else (
    where py >nul 2>nul
    if !errorlevel!==0 (
        set PYCMD=py
    ) else (
        echo [ERROR] Python was not found on this system.
        echo Install Python from https://www.python.org/downloads/
        echo and make sure "Add to PATH" is checked during setup.
        echo.
        pause
        exit /b 1
    )
)

netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul 2>nul
if %errorlevel%==0 (
    echo [ERROR] Port %PORT% is already in use.
    echo Close whatever is using it, or edit PORT in this file, then try again.
    echo.
    pause
    exit /b 1
)

rem --- Find this machine's LAN IPv4 address, so other devices on the same
rem     network can reach the server too (not just this PC). Try PowerShell
rem     first since it correctly skips loopback/link-local addresses; fall
rem     back to parsing ipconfig if PowerShell isn't available.
set "LANIP="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object { $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' } ^| Select-Object -First 1 -ExpandProperty IPAddress)" 2^>nul`) do set "LANIP=%%i"

if not defined LANIP (
    for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
        if not defined LANIP set "LANIP=%%a"
    )
    set "LANIP=!LANIP: =!"
)

rem --- Bind explicitly to all network interfaces (0.0.0.0) so the server is
rem     reachable from other devices on the same Wi-Fi/LAN, not just
rem     localhost.
echo Starting server on port %PORT% using !PYCMD! ...
start "VideoInputMonitor Server" /min cmd /c "!PYCMD! -m http.server %PORT% --bind 0.0.0.0"

timeout /t 2 /nobreak >nul

echo Opening browser...
start "" http://localhost:%PORT%/index.html

rem --- Build the ESC character so we can emit a real clickable hyperlink
rem     (OSC 8) when the terminal supports it. Windows Terminal (WT_SESSION
rem     is set) and modern PowerShell hosts render this as an actual link;
rem     everywhere else we just print the plain URL text instead, since raw
rem     escape codes would otherwise show up as garbage characters.
for /F "delims=#" %%e in ('"prompt #$E# & for %%x in (1) do rem"') do set "ESC=%%e"

echo.
echo VideoInputMonitor is running at:
if defined WT_SESSION (
    echo   Local:    !ESC!]8;;http://localhost:%PORT%/index.html!ESC!\http://localhost:%PORT%/index.html!ESC!]8;;!ESC!\
    if defined LANIP (
        echo   Network:  !ESC!]8;;http://%LANIP%:%PORT%/index.html!ESC!\http://%LANIP%:%PORT%/index.html!ESC!]8;;!ESC!\   ^(other devices on this Wi-Fi/LAN^)
    )
) else (
    echo   Local:    http://localhost:%PORT%/index.html
    if defined LANIP (
        echo   Network:  http://%LANIP%:%PORT%/index.html   ^(other devices on this Wi-Fi/LAN^)
    )
    echo   ^(Ctrl+click a link above if your terminal supports it, or copy/paste it into a browser.^)
)
if not defined LANIP (
    echo   Network:  could not detect a LAN IP automatically — run "ipconfig" to find it manually.
)
echo.
echo If Windows Firewall prompts you, allow access on Private networks
echo so other devices can reach the Network URL above.
echo.
echo Keep this window open while you use it.
echo Closing this window stops the server.
echo ============================================
echo.

pause >nul

echo Stopping server...
taskkill /fi "WINDOWTITLE eq VideoInputMonitor Server*" /f >nul 2>nul

exit /b 0
