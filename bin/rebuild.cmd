@echo off
title AMP - Rebuild
setlocal
rem Force a fresh packaged build, then launch.
set "ROOT=%~dp0.."
call "%ROOT%\bin\amp.cmd" --rebuild
exit /b %ERRORLEVEL%
