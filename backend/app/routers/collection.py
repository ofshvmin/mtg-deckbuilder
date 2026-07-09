"""Collection endpoints: import a collection CSV/Excel file, and summarize what's owned."""
from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from .. import db
from ..auth.deps import get_current_user
from ..models.responses import CollectionSummary, ImportResultResponse
from ..repositories import collection as collection_repo
from ..services import importer

router = APIRouter(prefix="/collection", tags=["collection"])

_EXCEL_EXTENSIONS = {".xls", ".xlsx"}
_EXCEL_MIMETYPES = {
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


def _is_excel(filename: str | None, content_type: str | None) -> bool:
    ext = os.path.splitext(filename or "")[1].lower()
    return ext in _EXCEL_EXTENSIONS or (content_type or "") in _EXCEL_MIMETYPES


@router.get("/summary", response_model=CollectionSummary)
async def summary(current_user: dict = Depends(get_current_user)):
    database = db.get_db()
    unique = await collection_repo.unique_owned_count(database, current_user["_id"])
    total = await collection_repo.total_copies(database, current_user["_id"])
    return CollectionSummary(has_collection=unique > 0, total_cards=total, unique_cards=unique)


@router.post("/import", response_model=ImportResultResponse)
async def import_collection(
    file: UploadFile = File(...),
    format: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user),
):
    raw = await file.read()

    try:
        if _is_excel(file.filename, file.content_type):
            result = await importer.import_collection(
                db.get_db(), current_user["_id"], format_name=format, excel_bytes=raw,
            )
        else:
            try:
                text = raw.decode("utf-8-sig")
            except UnicodeDecodeError:
                text = raw.decode("latin-1")
            result = await importer.import_collection(
                db.get_db(), current_user["_id"], csv_text=text, format_name=format,
            )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))

    return ImportResultResponse(
        total=result.total,
        matched=result.matched,
        unmatched=result.unmatched,
        unique_owned=result.unique_owned,
        unmatched_names=result.unmatched_names[:50],
        detected_format=result.detected_format,
    )
