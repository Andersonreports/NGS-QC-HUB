from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import require_role
from ..security import hash_password
from ..workflow import ROLES

router = APIRouter(prefix="/api/admin", tags=["admin"])

ALL_ROLES = ROLES


@router.get("/users", response_model=List[schemas.UserOut])
def list_users(db: Session = Depends(get_db), _admin=Depends(require_role("primary_head"))):
    return db.query(models.User).order_by(models.User.created_at).all()


@router.post("/users", response_model=schemas.UserOut)
def create_user(payload: schemas.CreateUserRequest, db: Session = Depends(get_db), _admin=Depends(require_role("primary_head"))):
    if payload.role not in ALL_ROLES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"role must be one of {ALL_ROLES}")
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
def deactivate_user(user_id: str, db: Session = Depends(get_db), _admin=Depends(require_role("primary_head"))):
    user = db.get(models.User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    user.is_active = False
    db.commit()
    db.refresh(user)
    return user


@router.post("/users/{user_id}/activate", response_model=schemas.UserOut)
def activate_user(user_id: str, db: Session = Depends(get_db), _admin=Depends(require_role("primary_head"))):
    user = db.get(models.User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    user.is_active = True
    db.commit()
    db.refresh(user)
    return user
