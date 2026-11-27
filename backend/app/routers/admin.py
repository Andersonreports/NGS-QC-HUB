from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import get_current_user
from ..security import hash_password
from ..workflow import ROLES, ADMIN_ROLE

router = APIRouter(prefix="/api/admin", tags=["admin"])

ALL_ROLES = [*ROLES, ADMIN_ROLE]

# Who may open User Management, and which roles each of them may create / manage.
# The check uses the account's TRUE role (real_role), never a role an admin or head is
# merely acting as through the role switcher.
CREATABLE_ROLES = {
    ADMIN_ROLE: list(ALL_ROLES),
    "bioinfo_head": ["wetlab", "primary_team", "primary_head", "bioinfo_head"],
    "primary_head": ["wetlab", "primary_team", "primary_head"],
}


def user_manager(user: models.User = Depends(get_current_user)) -> models.User:
    real = getattr(user, "real_role", user.role)
    if real not in CREATABLE_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not permitted to manage users")
    user.manager_role = real
    return user


def _require_can_manage(actor: models.User, target_role: str, verb: str):
    if target_role not in CREATABLE_ROLES[actor.manager_role]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"You are not permitted to {verb} a {target_role} account")


@router.get("/users", response_model=List[schemas.UserOut])
def list_users(db: Session = Depends(get_db), actor: models.User = Depends(user_manager)):
    # Only users at or below the caller's own level are visible: the higher roles are
    # hidden (a Primary Team Head doesn't see Bioinfo Heads or Admins; a Bioinfo Head
    # doesn't see Admins).
    return (
        db.query(models.User)
        .filter(models.User.role.in_(CREATABLE_ROLES[actor.manager_role]))
        .order_by(models.User.created_at)
        .all()
    )


@router.post("/users", response_model=schemas.UserOut)
def create_user(payload: schemas.CreateUserRequest, db: Session = Depends(get_db), actor: models.User = Depends(user_manager)):
    if payload.role not in ALL_ROLES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"role must be one of {ALL_ROLES}")
    _require_can_manage(actor, payload.role, "create")
    username = payload.username.strip().lower()
    if db.query(models.User).filter(models.User.username == username).first():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Username already exists")
    user = models.User(
        username=username,
        full_name=payload.full_name.strip(),
        role=payload.role,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/users/{user_id}/deactivate", response_model=schemas.UserOut)
def deactivate_user(user_id: str, db: Session = Depends(get_db), actor: models.User = Depends(user_manager)):
    user = db.get(models.User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    _require_can_manage(actor, user.role, "deactivate")
    user.is_active = False
    db.commit()
    db.refresh(user)
    return user


@router.post("/users/{user_id}/activate", response_model=schemas.UserOut)
def activate_user(user_id: str, db: Session = Depends(get_db), actor: models.User = Depends(user_manager)):
    user = db.get(models.User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    _require_can_manage(actor, user.role, "reactivate")
    user.is_active = True
    db.commit()
    db.refresh(user)
    return user
