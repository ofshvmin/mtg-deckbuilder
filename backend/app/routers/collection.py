"""Collection endpoints: import a collection CSV, and summarize what's owned."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from .. import db
from ..auth.deps import get_current_user
from ..models.responses import CollectionSummary, ImportResultResponse
from ..repositories import collection as collection_repo
from ..services import importer

router = APIRouter(prefix="/collection", tags=["collection"])


@router.get("/summary", response_model=CollectionSummary)
async def summary(current_user: dict = Depends(get_current_user)):
    database = db.get_db()
    unique = await collection_repo.unique_owned_count(database, current_user["_id"])
    total = await collection_repo.total_copies(database, current_user["_id"])
    return CollectionSummary(has_collection=unique > 0, total_cards=total, unique_cards=unique)


@router.post("/import", response_model=ImportResultResponse)
async def import_csv(
    file: UploadFile = File(...),
    format: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user),
):
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "File must be UTF-8 encoded CSV.")

    try:
        result = await importer.import_collection(db.get_db(), current_user["_id"], text, format_name=format)
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
