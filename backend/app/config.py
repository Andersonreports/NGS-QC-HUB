import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
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
