from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from .database import get_db
from .security import decode_access_token
from .workflow import ADMIN_ROLE, IMPERSONATABLE_ROLES
from . import models

bearer_scheme = HTTPBearer(auto_error=False)

# Header an admin sends to act as one of the pipeline roles for a single request.
ACT_AS_HEADER = "x-act-as-role"


def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> models.User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    user_id = decode_access_token(creds.credentials)
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    user = db.get(models.User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found or disabled")

    # An admin may act as any pipeline role for the duration of one request, chosen by
    # the X-Act-As-Role header the frontend's role switcher sends. We return a
    # *transient* stand-in (never added to the session, so never flushed or committed)
    # carrying the acting role, so every downstream user.role / require_role / stage
    # check treats the admin exactly as that role, with no change to those checks and
    # no risk of overwriting the admin's stored role. `real_role` keeps the true role
    # so the UI knows to show the switcher. A non-admin, or an unknown/blank header,
    # falls through unchanged.
    acting = (request.headers.get(ACT_AS_HEADER) or "").strip()
    if user.role == ADMIN_ROLE and acting in IMPERSONATABLE_ROLES:
        proxy = models.User(
            id=user.id,
            username=user.username,
            full_name=user.full_name,
            role=acting,
            is_active=True,
        )
        proxy.real_role = ADMIN_ROLE
        return proxy

    user.real_role = user.role
    return user


def require_role(*roles: str):
    def _check(user: models.User = Depends(get_current_user)) -> models.User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not permitted to perform this action")
        return user
    return _check
