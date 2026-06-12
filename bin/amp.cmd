@echo off
title AMP
setlocal
rem ---- AMP packaged launcher (Windows) ----
rem DRM playback needs the packaged app because castLabs VMP signing runs during pnpm dist.
set "ROOT=%~dp0.."
set "APP_EXE=%ROOT%\apps\desktop\dist\win-unpacked\AMP.exe"
rem icudtl.dat is required for Electron to boot; if a pack is incomplete and it's missing,
rem the app crashes instantly ("Invalid file descriptor to ICU data"). Treat it as a build marker.
set "APP_ICU=%ROOT%\apps\desktop\dist\win-unpacked\icudtl.dat"

cd /d "%ROOT%" || (echo Could not find the project folder. & pause & exit /b 1)

if /I "%~1"=="--check" (
  echo Project root: %ROOT%
  echo Packaged app: %APP_EXE%
  if exist "%APP_EXE%" (
    echo Packaged app found.
  ) else (
    echo Packaged app not found. Running without --check will build it with corepack pnpm dist.
  )
  if exist "%APP_ICU%" (
    echo ICU data found ^(build looks complete^).
  ) else (
    echo ICU data MISSING - the packaged build is incomplete; a rebuild is needed.
  )
  exit /b 0
)

if /I "%~1"=="--rebuild" (
  rem A running AMP locks its files, so deleting dist would fail and leave a broken folder.
  taskkill /F /IM AMP.exe >nul 2>&1
  if exist "%ROOT%\apps\desktop\dist" rmdir /s /q "%ROOT%\apps\desktop\dist"
)

rem Rebuild when the executable OR the ICU data is missing — a half-copied pack must not be
rem launched (it would crash silently). Clear any stale folder + running instance first.
set "NEEDS_BUILD="
if not exist "%APP_EXE%" set "NEEDS_BUILD=1"
if not exist "%APP_ICU%" set "NEEDS_BUILD=1"
if defined NEEDS_BUILD (
  echo Building packaged AMP with castLabs VMP signing. This can take a few minutes...
  taskkill /F /IM AMP.exe >nul 2>&1
  if exist "%ROOT%\apps\desktop\dist\win-unpacked" rmdir /s /q "%ROOT%\apps\desktop\dist\win-unpacked"
  call corepack pnpm install || goto :dist_error
  call corepack pnpm dist || goto :dist_error
)

echo Starting AMP...
start "" "%APP_EXE%"
exit /b 0

:dist_error
echo.
echo Packaged build failed.
echo DRM playback requires castLabs EVS to be installed and authenticated.
echo Try:
echo   corepack pnpm --filter @amp/desktop evs:reauth
echo Then run bin\amp.cmd again.
pause
exit /b 1
