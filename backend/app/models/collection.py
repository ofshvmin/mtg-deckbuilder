"""Pydantic model for a collection line item (one Mongo `collection_items` doc)."""
from pydantic import BaseModel


class CollectionItem(BaseModel):
    user_id: str
    oracle_id: str | None = None   # None if the CSV row didn't match a known card
    name: str
    name_normalized: str
    count: int = 1
    tradelist_count: int = 0
    edition: str | None = None
    condition: str | None = None
    language: str | None = None
    foil: str | None = None
    tags: str | None = None
    collector_number: str | None = None
    altered: str | None = None
    proxy: str | None = None
    purchase_price: float | None = None
