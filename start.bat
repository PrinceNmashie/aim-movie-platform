@echo off
cd /d "%~dp0"
if not exist .venv python -m venv .venv
if errorlevel 1 goto error
call .venv\Scripts\activate
python -m pip install -r requirements.txt
if errorlevel 1 goto error
if not exist .env copy .env.example .env >nul
python app.py
goto end
:error
echo Setup failed. Install Python 3.10 or newer and try again.
pause
:end
