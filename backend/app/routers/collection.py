"""Collection endpoints: import/export a collection, and summarize what's owned."""
from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel

from .. import db
from ..auth.deps import get_current_user
from ..models.responses import CardSearchResult, CollectionItemOut, CollectionSummary, ImportResultResponse
from ..repositories import cards as cards_repo
from ..repositories import collection as collection_repo
from ..services import csv_formats, importer
from ..util import normalize_name

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


# Canonical fields stored on each collection_item doc
_EXPORT_FIELDS = [
    "name", "count", "edition", "condition", "language", "foil",
    "tags", "collector_number", "purchase_price", "tradelist_count",
    "altered", "proxy",
]


@router.get("/export")
async def export_collection(
    format: str = Query("Moxfield"),
    current_user: dict = Depends(get_current_user),
):
    fmt = csv_formats.get_format_by_name(format)
    if not fmt:
        supported = ", ".join(f.name for f in csv_formats.FORMATS)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown format '{format}'. Supported: {supported}")

    database = db.get_db()
    items = await collection_repo.list_items(database, current_user["_id"])
    rows = [{k: str(item.get(k, "") or "") for k in _EXPORT_FIELDS} for item in items]
    csv_text = csv_formats.export_rows_csv(rows, fmt)

    filename = f"collection-{fmt.name.lower().replace(' ', '-')}.csv"
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/items", response_model=list[CollectionItemOut])
async def list_collection(current_user: dict = Depends(get_current_user)):
    database = db.get_db()
    items = await collection_repo.list_items(database, current_user["_id"])
    return [
        CollectionItemOut(
            oracle_id=item.get("oracle_id"),
            name=item.get("name", ""),
            count=item.get("count", 1),
            edition=item.get("edition"),
            condition=item.get("condition"),
            foil=item.get("foil"),
        )
        for item in items
    ]


class AddCardRequest(BaseModel):
    name: str
    count: int = 1


@router.post("/items", response_model=CollectionItemOut, status_code=status.HTTP_201_CREATED)
async def add_card(body: AddCardRequest, current_user: dict = Depends(get_current_user)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Card name is required.")
    database = db.get_db()
    card = await cards_repo.find_by_normalized_name(database, name)
    oracle_id = card["_id"] if card else None
    item = {
        "oracle_id": oracle_id,
        "name": card["name"] if card else name,
        "name_normalized": normalize_name(name),
        "count": body.count,
    }
    await collection_repo.add_item(database, current_user["_id"], item)
    return CollectionItemOut(
        oracle_id=oracle_id,
        name=item["name"],
        count=item["count"],
    )


@router.delete("/items/{oracle_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_card(oracle_id: str, current_user: dict = Depends(get_current_user)):
    database = db.get_db()
    removed = await collection_repo.remove_item(database, current_user["_id"], oracle_id)
    if not removed:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Card not found in collection.")


@router.get("/search-cards", response_model=list[CardSearchResult])
async def search_cards(q: str = "", limit: int = 20, current_user: dict = Depends(get_current_user)):
    database = db.get_db()
    docs = await cards_repo.search(database, q, limit=limit)
    return [
        CardSearchResult(
            oracle_id=d["_id"],
            name=d["name"],
            type_line=d.get("type_line", ""),
            mana_cost=d.get("mana_cost", ""),
        )
        for d in docs
    ]
