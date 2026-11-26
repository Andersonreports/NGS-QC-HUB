from .database import SessionLocal
from . import models
from .security import hash_password
from .tenancy import current_org

NGS_ACCOUNTS = [
    {"username": "wetlab", "full_name": "Wet Lab Team", "role": "wetlab", "password": "wetlab@123"},
    {"username": "sethu", "full_name": "Sethu", "role": "primary_team", "password": "sethu@123"},
    {"username": "tamilarasu", "full_name": "Tamilarasu", "role": "primary_head", "password": "tamilarasu@123"},
    {"username": "dr.muthukumaran", "full_name": "Dr. Muthukumaran", "role": "bioinfo_head", "password": "muthukumaran@123"},
]

NGS_ADMIN = {"username": "admin", "full_name": "Admin", "role": "admin", "password": "admin@123"}

# CMC has the same roles as NGS but its own, different logins.
CMC_ACCOUNTS = [
    {"username": "cmc.wetlab", "full_name": "Wet Lab Team", "role": "wetlab", "password": "cmc.wetlab@123"},
    {"username": "cmc.primary", "full_name": "Sethu", "role": "primary_team", "password": "cmc.primary@123"},
    {"username": "cmc.primaryhead", "full_name": "Tamilarasu", "role": "primary_head", "password": "cmc.primaryhead@123"},
    {"username": "cmc.bioinfohead", "full_name": "Dr. Muthukumaran", "role": "bioinfo_head", "password": "cmc.bioinfohead@123"},
]
CMC_ADMIN = {"username": "cmc.admin", "full_name": "Admin", "role": "admin", "password": "cmc.admin@123"}

# CMC databases created before this change hold the NGS usernames; these are renamed
# in place (same user row, so runs and history stay attached) to the CMC logins.
_CMC_LEGACY = {
    "wetlab": CMC_ACCOUNTS[0], "sethu": CMC_ACCOUNTS[1], "tamilarasu": CMC_ACCOUNTS[2],
    "dr.muthukumaran": CMC_ACCOUNTS[3], "admin": CMC_ADMIN,
}


def _accounts():
    return CMC_ACCOUNTS if current_org.get() == "cmc" else NGS_ACCOUNTS


def _admin():
    return CMC_ADMIN if current_org.get() == "cmc" else NGS_ADMIN


def seed_default_accounts():
    db = SessionLocal()
    try:
        if db.query(models.User).count() > 0:
            return
        for acc in _accounts():
            db.add(models.User(
                username=acc["username"],
                full_name=acc["full_name"],
                role=acc["role"],
                password_hash=hash_password(acc["password"]),
            ))
        db.commit()
        print("Seeded default accounts:", ", ".join(a["username"] for a in _accounts()))
    finally:
        db.close()


def ensure_admin_account():
    """Create the admin account if it isn't present yet. Runs on every startup (unlike
    seed_default_accounts, which only fills a brand-new database), so an already-seeded
    database gains the admin login without touching any existing user, run or history."""
    ADMIN_ACCOUNT = _admin()
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
        for acc in _accounts():
            user = db.query(models.User).filter(models.User.username == acc["username"]).first()
            if user and user.full_name != acc["full_name"]:
                changed.append(f"{acc['username']}: '{user.full_name}' -> '{acc['full_name']}'")
                user.full_name = acc["full_name"]
        if changed:
            db.commit()
            print("Updated display names:", "; ".join(changed))
    finally:
        db.close()


def migrate_cmc_logins():
    """One-time: give an existing CMC database its own logins (see _CMC_LEGACY). Skips any
    account whose new username already exists, so it is safe to run on every startup."""
    if current_org.get() != "cmc":
        return
    db = SessionLocal()
    try:
        for old, acc in _CMC_LEGACY.items():
            user = db.query(models.User).filter(models.User.username == old).first()
            taken = db.query(models.User).filter(models.User.username == acc["username"]).first()
            if user and not taken and user.role == acc["role"]:
                user.username = acc["username"]
                user.password_hash = hash_password(acc["password"])
                print(f"CMC login renamed: {old} -> {acc['username']}")
        db.commit()
    finally:
        db.close()
