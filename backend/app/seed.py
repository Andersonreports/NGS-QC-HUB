from .database import SessionLocal
from . import models
from .security import hash_password

DEFAULT_ACCOUNTS = [
    {"username": "wetlab", "full_name": "Wet Lab Team", "role": "wetlab", "password": "wetlab@123"},
    {"username": "sethu", "full_name": "Sethu", "role": "primary_team", "password": "sethu@123"},
    {"username": "tamilarasu", "full_name": "Tamilarasu", "role": "primary_head", "password": "tamilarasu@123"},
    {"username": "dr.muthukumaran", "full_name": "Dr. Muthukumaran", "role": "bioinfo_head", "password": "muthukumaran@123"},
]

# A single admin account that can act as any role (for testing/administration).
ADMIN_ACCOUNT = {"username": "admin", "full_name": "Admin", "role": "admin", "password": "admin@123"}


def seed_default_accounts():
    db = SessionLocal()
    try:
        if db.query(models.User).count() > 0:
            return
        for acc in DEFAULT_ACCOUNTS:
            db.add(models.User(
                username=acc["username"],
                full_name=acc["full_name"],
                role=acc["role"],
                password_hash=hash_password(acc["password"]),
            ))
        db.commit()
        print("Seeded default accounts:", ", ".join(a["username"] for a in DEFAULT_ACCOUNTS))
    finally:
        db.close()


def ensure_admin_account():
    """Create the admin account if it isn't present yet. Runs on every startup (unlike
    seed_default_accounts, which only fills a brand-new database), so an already-seeded
    database gains the admin login without touching any existing user, run or history."""
    db = SessionLocal()
    try:
        exists = (
            db.query(models.User)
            .filter(models.User.username == ADMIN_ACCOUNT["username"])
            .first()
        )
        if exists:
            return
        db.add(models.User(
            username=ADMIN_ACCOUNT["username"],
            full_name=ADMIN_ACCOUNT["full_name"],
            role=ADMIN_ACCOUNT["role"],
            password_hash=hash_password(ADMIN_ACCOUNT["password"]),
        ))
        db.commit()
        print(f"Created admin account: {ADMIN_ACCOUNT['username']} / {ADMIN_ACCOUNT['password']}")
    finally:
        db.close()


def sync_seed_display_names():
    """Bring an already-seeded database's display names up to date without touching
    anything else — runs & history are untouched; only the `full_name` on the known
    seed usernames is corrected if it's drifted from DEFAULT_ACCOUNTS."""
    db = SessionLocal()
    try:
        changed = []
        for acc in DEFAULT_ACCOUNTS:
            user = db.query(models.User).filter(models.User.username == acc["username"]).first()
            if user and user.full_name != acc["full_name"]:
                changed.append(f"{acc['username']}: '{user.full_name}' -> '{acc['full_name']}'")
                user.full_name = acc["full_name"]
        if changed:
            db.commit()
            print("Updated display names:", "; ".join(changed))
    finally:
        db.close()
