@echo off
rem Build dist\CrewHealthHub.exe on a Windows PC (the GitHub Actions workflow does the same).
rem Needs Python 3.11+ and Node.js 18+.
setlocal
cd /d "%~dp0\.."
if not exist ".build-venv\Scripts\python.exe" python -m venv .build-venv || exit /b 1
".build-venv\Scripts\python.exe" -m pip install -q --upgrade pip
".build-venv\Scripts\python.exe" -m pip install -q -r backend\requirements.txt pyinstaller==6.22.3 || exit /b 1
pushd frontend
call npm ci --no-audit --no-fund || exit /b 1
call npm run build || exit /b 1
popd
".build-venv\Scripts\pyinstaller.exe" --noconfirm packaging\CrewHealthHub.spec || exit /b 1
echo.
echo Built: %CD%\dist\CrewHealthHub.exe
