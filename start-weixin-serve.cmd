@echo off
setlocal
cd /d "%~dp0"
if not defined CODEX_APP_SERVER_TRANSPORT set "CODEX_APP_SERVER_TRANSPORT=stdio"
if not defined CODEXBRIDGE_LOCALE set "CODEXBRIDGE_LOCALE=zh-CN"
if not defined CODEXBRIDGE_DEFAULT_CWD if defined USERPROFILE if exist "%USERPROFILE%\Documents\" set "CODEXBRIDGE_DEFAULT_CWD=%USERPROFILE%\Documents"
if not defined CODEXBRIDGE_DEFAULT_CWD set "CODEXBRIDGE_DEFAULT_CWD=%CD%"
npm run weixin:serve -- --cwd "%CODEXBRIDGE_DEFAULT_CWD%"
