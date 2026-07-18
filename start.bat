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

rem --- Find every LAN IPv4 address on this machine, so other devices on the
rem     same network can reach the server too (not just this PC), and so
rem     you can see all of them if this PC has more than one active adapter
rem     (e.g. both Wi-Fi and Ethernet).
rem
rem     Skips any adapter that looks like a VPN/virtual/tunnel interface by
rem     name — Tailscale, WireGuard, and similar tools install their own
rem     virtual adapter, which only other devices on that same virtual
rem     network can reach, not everything on your actual Wi-Fi/LAN. The
rem     adapter that owns the default route (best metric) is listed first;
rem     any other non-VPN adapters with an IPv4 address are listed after it.
set "LANCOUNT=0"
rem NOTE: the regex alternation below uses ^| (not a bare |) between each
rem term. Inside a for /f backtick command, cmd.exe scans for pipe
rem characters even inside quoted strings, so a plain | here — even one
rem that's just regex syntax, not an actual pipeline — gets misread as a
rem command pipe and silently breaks the whole line. Hence no shared
rem %VPNPATTERN% variable: substituting one in would carry raw, unescaped
rem pipes into this context.
for /f "usebackq tokens=1,2 delims=," %%i in (`powershell -NoProfile -Command "$vpnPattern = 'Tailscale^|WireGuard^|VPN^|TAP^|ZeroTier^|Hamachi^|Cisco^|OpenVPN^|Nord^|utun^|PPP^|Loopback'; $defaultIdx = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue ^| Sort-Object -Property RouteMetric ^| Select-Object -First 1 -ExpandProperty InterfaceIndex; Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue ^| Where-Object { $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' } ^| ForEach-Object { $ipObj = $_; $a = Get-NetAdapter -InterfaceIndex $ipObj.InterfaceIndex -ErrorAction SilentlyContinue; if ($a -and $a.Name -notmatch $vpnPattern -and $a.InterfaceDescription -notmatch $vpnPattern) { [PSCustomObject]@{IP=$ipObj.IPAddress; Name=$a.Name; IsDefault=($ipObj.InterfaceIndex -eq $defaultIdx)} } } ^| Sort-Object -Property @{Expression={ -not $_.IsDefault }} ^| ForEach-Object { '{0},{1}' -f $_.IP, $_.Name }" 2^>nul`) do (
    set /a LANCOUNT+=1
    set "LANIP_!LANCOUNT!=%%i"
    set "LANADAPTER_!LANCOUNT!=%%j"
)

if !LANCOUNT!==0 (
    rem PowerShell approach found nothing (older Windows without the
    rem NetTCPIP/NetAdapter cmdlets, etc.) — fall back to parsing ipconfig
    rem and take every non-loopback, non-APIPA address it reports.
    for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
        set "TEMPIP=%%a"
        set "TEMPIP=!TEMPIP: =!"
        if not "!TEMPIP!"=="127.0.0.1" if not "!TEMPIP:~0,7!"=="169.254" (
            set /a LANCOUNT+=1
            set "LANIP_!LANCOUNT!=!TEMPIP!"
            set "LANADAPTER_!LANCOUNT!=unknown adapter"
        )
    )
)

rem --- Make sure Windows Firewall isn't silently dropping inbound
rem     connections on this port — the most common reason the page loads
rem     fine locally but times out / refuses on other devices. This adds a
rem     scoped rule (Private + Domain networks only) if one doesn't already
rem     exist. Requires admin rights to succeed; if it can't (not elevated),
rem     it fails harmlessly and we tell you so in the summary below.
set "FWNOTE="
netsh advfirewall firewall show rule name="VideoInputMonitor %PORT%" | findstr /i "No rules match" >nul 2>nul
if %errorlevel%==0 (
    netsh advfirewall firewall add rule name="VideoInputMonitor %PORT%" dir=in action=allow protocol=TCP localport=%PORT% profile=private,domain >nul 2>nul
    if !errorlevel!==0 (
        set "FWNOTE=Added a Windows Firewall rule allowing inbound TCP %PORT% (Private/Domain networks)."
    ) else (
        set "FWNOTE=Could not add a firewall rule automatically (needs admin). If other devices still can't connect: right-click start.bat, 'Run as administrator', once - or allow python.exe / TCP port %PORT% manually in Windows Defender Firewall."
    )
) else (
    set "FWNOTE=Firewall rule for port %PORT% already present."
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
    if !LANCOUNT! GTR 0 (
        for /l %%n in (1,1,!LANCOUNT!) do (
            echo   Network:  !ESC!]8;;http://!LANIP_%%n!:%PORT%/index.html!ESC!\http://!LANIP_%%n!:%PORT%/index.html!ESC!]8;;!ESC!\   ^(!LANADAPTER_%%n!^)
        )
    )
) else (
    echo   Local:    http://localhost:%PORT%/index.html
    if !LANCOUNT! GTR 0 (
        for /l %%n in (1,1,!LANCOUNT!) do (
            echo   Network:  http://!LANIP_%%n!:%PORT%/index.html   ^(!LANADAPTER_%%n!^)
        )
    )
    echo   ^(Ctrl+click a link above if your terminal supports it, or copy/paste it into a browser.^)
)
if !LANCOUNT!==0 (
    echo   Network:  could not detect a LAN IP automatically — run "ipconfig" to find it manually.
)
echo.
echo %FWNOTE%
echo.
echo If other devices still can't connect after this:
echo   - If more than one Network URL is listed above, try each one — only
echo     the address on the same Wi-Fi/Ethernet segment as the other device
echo     will work.
echo   - Confirm this PC's network is set to "Private" ^(not "Public"^) in
echo     Windows Settings, Network and internet.
echo   - Make sure the other device is on the SAME Wi-Fi network ^(not a
echo     guest network — many routers isolate guest devices from each other^).
echo   - Some routers have "AP/Client Isolation" enabled, which blocks
echo     device-to-device traffic even on the same network; check router
echo     settings if the above doesn't fix it.
echo.
echo Keep this window open while you use it.
echo Closing this window stops the server.
echo ============================================
echo.

pause >nul

echo Stopping server...
taskkill /fi "WINDOWTITLE eq VideoInputMonitor Server*" /f >nul 2>nul

exit /b 0
