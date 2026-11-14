@echo off
rem Crew Health Hub - Windows launcher (from source).
rem   run.bat          set up (first run), build the UI, start and open the browser
rem   run.bat test     run the pytest suite
rem   run.bat rebuild  rebuild the UI, then start
rem Needs Python 3.11+ (python.org) and, to build the UI, Node.js 18+ (nodejs.org).
rem No Python/Node? Use CrewHealthHub.exe instead (see README).
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python 3.11+ is required: https://www.python.org/downloads/
  exit /b 1
)

if not exist "backend\.venv\Scripts\python.exe" (
  echo ==^> Creating Python virtual environment
  python -m venv backend\.venv || exit /b 1
)
if not exist "backend\.venv\.deps-installed" (
  echo ==^> Installing Python packages
  "backend\.venv\Scripts\python.exe" -m pip install -q --upgrade pip
  "backend\.venv\Scripts\python.exe" -m pip install -q -r backend\requirements.txt || exit /b 1
  type nul > "backend\.venv\.deps-installed"
)

if /i "%~1"=="test" (
  cd backend
  "..\backend\.venv\Scripts\python.exe" -m pytest -q
  exit /b %errorlevel%
)

set NEED_BUILD=0
if not exist "frontend\dist\index.html" set NEED_BUILD=1
if /i "%~1"=="rebuild" set NEED_BUILD=1
if "%NEED_BUILD%"=="1" (
  where npm >nul 2>nul
  if errorlevel 1 (
    echo Node.js 18+ is required to build the UI: https://nodejs.org/
    exit /b 1
  )
  echo ==^> Building the UI
  pushd frontend
  call npm install --no-audit --no-fund || exit /b 1
  call npm run build || exit /b 1
  popd
)

cd backend
if /i "%~1"=="rebuild" (
  "..\backend\.venv\Scripts\python.exe" launcher.py
) else (
  "..\backend\.venv\Scripts\python.exe" launcher.py %*
)
