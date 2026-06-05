@echo off
cd /d "%~dp0"
echo Starting 3FDP Biggest Loser...
echo.

echo Checking Node...
node -e "console.log(process.execPath + ' ' + process.version)"
if errorlevel 1 goto node_failed

echo Checking local web server permission...
node -e "const net=require('node:net'); const s=net.createServer(); s.on('error', e=>{console.error(e); process.exit(2)}); s.listen(0,'127.0.0.1',()=>{console.log('Local server test OK on port ' + s.address().port); s.close(()=>process.exit(0));}); setTimeout(()=>process.exit(3), 3000);"
set TEST_EXIT=%ERRORLEVEL%
if not "%TEST_EXIT%"=="0" goto listen_failed

start "" "http://127.0.0.1:3000"
node server.js
echo Server exited with code %ERRORLEVEL%.
goto done

:node_failed
echo Node could not run. Reinstall Node.js LTS from nodejs.org.
goto done

:listen_failed
echo.
echo Node is installed, but Windows is blocking Node from opening a local web server.
echo If the code is -1073741795, Node crashed with a native Windows illegal-instruction error.
echo Fix: uninstall Node.js v24, then install the Windows x64 LTS version from nodejs.org.
echo You can also try allowing node.exe through Windows Security / Firewall.
echo Node path shown above is the one Windows is running.
echo Test exit code: %TEST_EXIT%
goto done

:done
echo.
echo If this window shows an error, send Codex a screenshot or copy the message.
pause
