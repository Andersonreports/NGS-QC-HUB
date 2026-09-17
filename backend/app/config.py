import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
# A backend/.env file (not committed — see .env.example) is the normal way to set
# the SMTP_* variables below without exporting them by hand before every start.
load_dotenv(BASE_DIR / ".env")
# Override with NGS_DATA_DIR to point a second instance (e.g. a throwaway one used
# only to verify a change) at its own database and uploads, instead of the real one.
DATA_DIR = Path(os.environ["NGS_DATA_DIR"]) if os.environ.get("NGS_DATA_DIR") else BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

UPLOADS_DIR = DATA_DIR / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "ngsqc.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"

SECRET_KEY_PATH = DATA_DIR / "secret.key"
if SECRET_KEY_PATH.exists():
    SECRET_KEY = SECRET_KEY_PATH.read_text().strip()
else:
    SECRET_KEY = secrets.token_hex(32)
    SECRET_KEY_PATH.write_text(SECRET_KEY)

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 14  # 14 days

MAX_UPLOAD_BYTES = 200 * 1024 * 1024  # 200 MB per file

# Outgoing mail for the "new transfer" notice to Bioinfo. All optional — if
# SMTP_HOST isn't set, sending is skipped (logged, never blocks the transfer
# itself) so a dev/test instance never needs real mail credentials.
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USERNAME = os.environ.get("SMTP_USERNAME", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_USE_TLS = os.environ.get("SMTP_USE_TLS", "true").lower() not in ("false", "0", "no")
SMTP_FROM = os.environ.get("SMTP_FROM", SMTP_USERNAME)
BIOINFO_NOTIFY_EMAIL = os.environ.get("BIOINFO_NOTIFY_EMAIL", "bioinfo@andersondiagnostics.in")
