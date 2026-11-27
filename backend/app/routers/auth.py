from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import SessionLocal, get_db
from ..deps import get_current_user
from ..tenancy import ORG_IDS, current_org
from ..security import verify_password, create_access_token, hash_password

router = APIRouter(prefix="/api/auth", tags=["auth"])

# The admin and the Bioinfo Head are single, shared accounts: they sign in through NGS
# and get a session in every organization. The CMC rows for these two roles remain only
# as that session's identity (so history stays attached) and cannot be signed into directly.
SHARED_ROLES = ("admin", "bioinfo_head")
SHARED_HOME_ORG = ORG_IDS[0]

# Roles that may open the VSWarehouse token monitor.
VSW_ROLES = ("admin", "primary_team", "primary_head", "bioinfo_head")


@router.post("/portal-login", response_model=schemas.PortalLoginResponse)
def portal_login(payload: schemas.LoginRequest):
    """Single sign-in for the landing page. The organization is not chosen up front: the
    username is looked up in each organization's own database (logins are distinct per
    organization). An admin is the one combined account, so it also gets a session for
    every organization that has an admin account."""
    username = payload.username.strip().lower()
    found = None
    for org in ORG_IDS:
        tok = current_org.set(org)
        db = SessionLocal()
        try:
            user = db.query(models.User).filter(models.User.username == username).first()
            if user and user.is_active and verify_password(payload.password, user.password_hash) and not (
                user.role in SHARED_ROLES and org != SHARED_HOME_ORG
            ):
                found = (org, user.role, user.full_name, user.username)
                break
        finally:
            db.close()
            current_org.reset(tok)
    if not found:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect username or password")
    home_org, role, full_name, uname = found

    sessions = []
    for org in ORG_IDS:
        if org != home_org and role not in SHARED_ROLES:
            continue
        tok = current_org.set(org)
        db = SessionLocal()
        try:
            user = (
                db.query(models.User).filter(models.User.username == uname).first()
                if org == home_org
                else db.query(models.User).filter(models.User.role == role, models.User.is_active == True).first()  # noqa: E712
            )
            if not user:
                continue
            user.real_role = user.role
            sessions.append(schemas.PortalSession(
                org=org, access_token=create_access_token(user.id, org),
                user=schemas.UserOut.model_validate(user),
            ))
        finally:
            db.close()
            current_org.reset(tok)
    return schemas.PortalLoginResponse(org=home_org, role=role, full_name=full_name, sessions=sessions)

@router.post("/login", response_model=schemas.TokenResponse)
def login(payload: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == payload.username.strip().lower()).first()
    if not user or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect username or password")
    if user.role in SHARED_ROLES and current_org.get() != SHARED_HOME_ORG:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect username or password")
    if payload.site == "vswarehouse" and user.role not in VSW_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "VSWarehouse is not available for this account")
    token = create_access_token(user.id, current_org.get())
    user.real_role = user.role
    return schemas.TokenResponse(access_token=token, user=schemas.UserOut.model_validate(user))


@router.get("/me", response_model=schemas.UserOut)
def me(user: models.User = Depends(get_current_user)):
    return schemas.UserOut.model_validate(user)


@router.patch("/password")
def change_password(
    payload: schemas.ChangePasswordRequest,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(payload.old_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    user.password_hash = hash_password(payload.new_password)
    db.commit()
    return {"ok": True}
