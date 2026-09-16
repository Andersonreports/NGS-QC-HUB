from .database import SessionLocal
from . import models
from .security import hash_password

DEFAULT_ACCOUNTS = [
    {"username": "admin", "full_name": "Administrator", "role": "admin", "password": "admin@123"},
    {"username": "wetlab", "full_name": "Wet Lab Team", "role": "wetlab", "password": "wetlab@123"},
    {"username": "primary", "full_name": "Sethu", "role": "primary_team", "password": "primary@123"},
    {"username": "phead", "full_name": "Tamilarasu", "role": "primary_head", "password": "phead@123"},
    {"username": "bhead", "full_name": "Dr. Muthukumaran", "role": "bioinfo_head", "password": "bhead@123"},
]


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
