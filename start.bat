@echo off
REM Start Germline Exome QC Hub on Windows (first run sets everything up).
setlocal
cd /d "%~dp0"
if "%PORT%"=="" set PORT=9000

if not exist frontend\dist (
  echo Building frontend...
  pushd frontend
  call npm install || exit /b 1
  call npm run build || exit /b 1
  popd
)

if not exist backend\vswarehouse\node_modules (
  echo Installing token monitor dependencies...
  pushd backend\vswarehouse
  call npm install || exit /b 1
  popd
)

cd backend
if not exist .venv\Scripts\activate.bat (
  echo Creating Python virtual environment...
  if exist .venv rmdir /s /q .venv
  python -m venv .venv || exit /b 1
  call .venv\Scripts\activate.bat
  python -m pip install -r requirements.txt || exit /b 1
) else (
  call .venv\Scripts\activate.bat
)

for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  set LAN_IP=%%a
  goto :got
)
:got
set LAN_IP=%LAN_IP: =%
echo.
echo   Germline Exome QC Hub is starting...
echo   On this machine:      http://localhost:%PORT%
echo   For everyone on LAN:  http://%LAN_IP%:%PORT%
echo   Press Ctrl+C to stop.
echo.
uvicorn app.main:app --host 0.0.0.0 --port %PORT%
