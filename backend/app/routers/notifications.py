from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import get_current_user

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("", response_model=List[schemas.NotificationOut])
def list_notifications(
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return (
        db.query(models.Notification)
        .filter(models.Notification.role == user.role)
        .order_by(models.Notification.read.asc(), models.Notification.created_at.desc())
        .all()
    )


@router.post("/read-all")
def mark_all_read(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    (
        db.query(models.Notification)
        .filter(models.Notification.role == user.role, models.Notification.read.is_(False))
        .update({"read": True})
    )
    db.commit()
    return {"ok": True}


@router.post("/{notification_id}/read")
def mark_read(notification_id: str, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    notif = db.get(models.Notification, notification_id)
    if not notif or notif.role != user.role:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found")
    notif.read = True
    db.commit()
    return {"ok": True}
