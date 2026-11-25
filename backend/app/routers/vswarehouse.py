"""VSWarehouse Token Monitor, exposed per organization.

Every endpoint requires a signed-in user, and the organization (and so the license, usage
CSVs and Google Sheet) is the one the session belongs to — it is never read from the URL or
body, so CMC and NGS data cannot be mixed. Changing data (upload / delete) is limited to the
Primary Team and the two team heads; everyone signed in may view.
"""
from fastapi import APIRouter, Depends, Request, Response

from .. import models, vswarehouse_service as svc
from ..deps import get_current_user, require_role
from ..tenancy import current_org

router = APIRouter(prefix="/api/vswarehouse", tags=["vswarehouse"])

_editor = require_role("primary_team", "primary_head", "bioinfo_head")


def _relay(method: str, path: str, body: bytes | None = None, content_type: str | None = None) -> Response:
    status, ctype, disposition, data = svc.request(method, path, body, content_type)
    headers = {"Content-Disposition": disposition} if disposition else {}
    return Response(content=data, status_code=status, media_type=ctype or "application/json", headers=headers)


def _m() -> str:
    return current_org.get()


@router.get("/module")
def module_meta(_: models.User = Depends(get_current_user)):
    status, ctype, _d, data = svc.request("GET", "/api/modules")
    if status != 200:
        return Response(content=data, status_code=status, media_type=ctype or "application/json")
    import json
    mod = next((m for m in json.loads(data) if m["id"] == _m()), None)
    if not mod:
        return Response(content=b'{"error":"Unknown module."}', status_code=404, media_type="application/json")
    return mod


@router.get("/csv")
def csv_org(_: models.User = Depends(get_current_user)):
    return _relay("GET", f"/api/orgs/{_m()}")


@router.get("/sheet")
def sheet(_: models.User = Depends(get_current_user)):
    return _relay("GET", f"/api/sheet/{_m()}")


@router.get("/report")
def report(_: models.User = Depends(get_current_user)):
    return _relay("GET", f"/api/report?m={_m()}")


@router.get("/uploads")
def uploads(_: models.User = Depends(get_current_user)):
    return _relay("GET", f"/api/uploads/{_m()}")


@router.post("/upload")
async def upload(request: Request, _: models.User = Depends(_editor)):
    body = await request.body()
    return _relay("POST", f"/api/upload?m={_m()}", body, request.headers.get("content-type"))


@router.delete("/upload")
def delete_all(_: models.User = Depends(_editor)):
    return _relay("DELETE", f"/api/upload/{_m()}")


@router.post("/uploads/restore")
def restore(_: models.User = Depends(_editor)):
    return _relay("POST", f"/api/uploads/{_m()}/restore")


@router.delete("/uploads/{upload_id}")
def delete_one(upload_id: str, _: models.User = Depends(_editor)):
    from urllib.parse import quote
    return _relay("DELETE", f"/api/uploads/{_m()}/{quote(upload_id, safe='')}")
