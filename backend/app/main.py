from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from .database import Base, engines
from .tenancy import ORG_IDS, DEFAULT_ORG, current_org, normalize_org
from .migrations import run_migrations
from .routers import auth, runs, notifications, admin, sheets, reports, dashboard, qc_report
from .seed import seed_default_accounts, sync_seed_display_names, ensure_admin_account
from .database import SessionLocal
from .file_naming import rename_existing_consolidated_files

def _init_org(org: str):
    token = current_org.set(org)
    try:
        Base.metadata.create_all(bind=engines[org])
        run_migrations(engines[org])
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
    finally:
        current_org.reset(token)


for _org in ORG_IDS:
    _init_org(_org)

app = FastAPI(title="Germline Exome QC Hub API")

@app.middleware("http")
async def select_organization(request, call_next):
    """Scope the whole request to one organization's data, from the X-Org header."""
    org = normalize_org(request.headers.get("x-org")) or DEFAULT_ORG
    token = current_org.set(org)
    try:
        return await call_next(request)
    finally:
        current_org.reset(token)


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
app.include_router(qc_report.router)
app.include_router(dashboard.router)

FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        # An unknown /api/... address must be a real 404. Answering it with the web page and a
        # 200 made a missing endpoint look like a successful (but corrupt) file download.
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
