"""Pydantic models for cards, mirroring the Mongo `cards` document shape.

In Mongo, `_id` is the Scryfall oracle_id, and list fields (colors, color_identity,
keywords, produced_mana) are stored as native arrays — no JSON strings.
"""
from pydantic import BaseModel, Field


class Card(BaseModel):
    oracle_id: str = Field(alias="_id")
    name: str
    name_normalized: str
    mana_cost: str = ""
    cmc: float = 0.0
    type_line: str = ""
    oracle_text: str = ""
    colors: list[str] = []
    color_identity: list[str] = []
    keywords: list[str] = []
    produced_mana: list[str] | None = None
    power: str | None = None
    toughness: str | None = None
    loyalty: str | None = None
    layout: str | None = None
    legal_commander: str = "not_legal"
    is_basic_land: bool = False
    released_at: str | None = None

    model_config = {"populate_by_name": True}


class OwnedCard(Card):
    copies_owned: int = 0
