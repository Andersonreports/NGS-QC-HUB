@echo off
REM Start the Germline Exome QC Hub backend (serves the built frontend too, if present).
cd /d "%~dp0"
call .venv\Scripts\activate.bat
uvicorn app.main:app --host 0.0.0.0 --port 9000
