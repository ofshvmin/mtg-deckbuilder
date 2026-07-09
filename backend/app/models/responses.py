"""Response schemas for the read API (collection, commanders, pool)."""
from pydantic import BaseModel


class CommanderOption(BaseModel):
    oracle_id: str
    name: str
    type_line: str
    color_identity: list[str]


class CardSummary(BaseModel):
    oracle_id: str
    name: str
    mana_cost: str
    cmc: float
    type_line: str
    color_identity: list[str]
    oracle_text: str = ""


class PoolCard(BaseModel):
    oracle_id: str
    name: str
    mana_cost: str
    cmc: float
    type_line: str
    color_identity: list[str]
    copies_owned: int
    is_land: bool


class CurveBucket(BaseModel):
    cmc: int          # 0..7, where 7 means "7+"
    count: int


class PoolResponse(BaseModel):
    commander: CardSummary
    color_identity: list[str]
    pool_size: int
    land_count: int
    curve: list[CurveBucket]
    pool: list[PoolCard]


class CollectionSummary(BaseModel):
    has_collection: bool
    total_cards: int          # sum of copies across all rows
    unique_cards: int         # distinct matched oracle cards


class ImportResultResponse(BaseModel):
    total: int
    matched: int
    unmatched: int
    unique_owned: int
    unmatched_names: list[str]
