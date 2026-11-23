from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from .database import Base, engine
from .migrations import run_migrations
from .routers import auth, runs, notifications, admin, sheets, reports, dashboard
from .seed import seed_default_accounts, sync_seed_display_names, ensure_admin_account
from .database import SessionLocal
from .file_naming import rename_existing_consolidated_files

Base.metadata.create_all(bind=engine)
run_migrations(engine)
seed_default_accounts()
sync_seed_display_names()
ensure_admin_account()

# Files uploaded before the "_consolidated" naming rule existed get renamed once.
_db = SessionLocal()
try:
    for _change in rename_existing_consolidated_files(_db):
        print("Renamed consolidated Excel:", _change)
finally:
    _db.close()

app = FastAPI(title="Germline Exome QC Hub API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(runs.router)
app.include_router(notifications.router)
app.include_router(admin.router)
app.include_router(sheets.router)
app.include_router(reports.router)
app.include_router(dashboard.router)

FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
