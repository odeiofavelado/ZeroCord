@echo off
cd /d "%~dp0"
if not exist node_modules\electron (
  echo Instalando o Electron pela primeira vez...
  call npm install
  node node_modules\electron\install.js
)
call npm run instalador
