@echo off
title ZeroCord Installer
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js was not found. Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
if not exist node_modules\electron\dist (
  echo Setting up ZeroCord for the first time. This can take a minute...
  call npm install --no-fund --no-audit
  node node_modules\electron\install.js
)
call npm run installer
