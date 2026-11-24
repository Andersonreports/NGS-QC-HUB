from datetime import datetime, timedelta, timezone

import bcrypt
from jose import jwt, JWTError

from .config import secret_key, JWT_ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(subject: str, org: str = "ngs") -> str:
    # org must be the current request's organization (selects the signing key).
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": subject, "org": org, "exp": expire}
    return jwt.encode(payload, secret_key(), algorithm=JWT_ALGORITHM)


def decode_access_token(token: str, org: str = "ngs"):
    """The user id in the token, or None if it's invalid, expired, or was issued for a
    different organization than `org` (tokens are not valid across organizations).
    Tokens from before organizations existed carry no claim and count as NGS."""
    try:
        payload = jwt.decode(token, secret_key(), algorithms=[JWT_ALGORITHM])
    except JWTError:
        return None
    if payload.get("org", "ngs") != org:
        return None
    return payload.get("sub")
