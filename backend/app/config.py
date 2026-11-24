import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
# A backend/.env file (not committed) is the normal way to set
# the SMTP_* variables below without exporting them by hand before every start.
load_dotenv(BASE_DIR / ".env")
# Override with NGS_DATA_DIR to point a second instance (e.g. a throwaway one used
# only to verify a change) at its own database and uploads, instead of the real one.
DATA_DIR = Path(os.environ["NGS_DATA_DIR"]) if os.environ.get("NGS_DATA_DIR") else BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

from .tenancy import ORG_IDS, DEFAULT_ORG, current_org  # noqa: E402


def org_data_dir(org: str) -> Path:
    """NGS keeps the original locations (existing data stays where it is); every other
    organization gets its own subfolder, so databases and files never mix."""
    # A sibling folder (not a subfolder of NGS's), or CMC_DATA_DIR etc. if set.
    override = os.environ.get(f"{org.upper()}_DATA_DIR")
    if override:
        d = Path(override)
    elif org == DEFAULT_ORG:
        d = DATA_DIR
    else:
        d = DATA_DIR.parent / f"{DATA_DIR.name}-{org}"
    d.mkdir(parents=True, exist_ok=True)
    return d


def org_uploads_dir(org: str) -> Path:
    d = org_data_dir(org) / "uploads"
    d.mkdir(parents=True, exist_ok=True)
    return d


def org_database_url(org: str) -> str:
    return f"sqlite:///{org_data_dir(org) / 'ngsqc.db'}"


def uploads_dir() -> Path:
    """Upload folder of the organization the current request belongs to."""
    return org_uploads_dir(current_org.get())

def org_secret_key(org: str) -> str:
    """Each organization signs its login tokens with its own key, stored in its own
    data folder, so a token can never validate against another organization."""
    path = org_data_dir(org) / "secret.key"
    if path.exists():
        return path.read_text().strip()
    key = secrets.token_hex(32)
    path.write_text(key)
    return key


_SECRET_KEYS = {org: org_secret_key(org) for org in ORG_IDS}


def secret_key() -> str:
    return _SECRET_KEYS[current_org.get()]


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
