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


class DeckCardOut(BaseModel):
    oracle_id: str
    name: str
    mana_cost: str
    cmc: float
    type_line: str
    color_identity: list[str]
    roles: list[str]
    slot: str
    reason: str
    count: int
    quality: float
    in_combo: bool = False


class ComboOut(BaseModel):
    id: str
    cards: list[str]          # card names
    produces: list[str]       # what the combo does
    popularity: int
    missing_name: str | None = None   # set only for "near" combos (one card away)


class GeneratedDeckResponse(BaseModel):
    commander: CardSummary
    color_identity: list[str]
    total: int
    land_count: int
    nonland_count: int
    role_counts: dict[str, int]
    curve: list[CurveBucket]
    color_sources: dict[str, int]
    stats: dict[str, float]
    warnings: list[str]
    edhrec_available: bool
    combos: list[ComboOut]        # combos fully present in the generated deck
    near_combos: list[ComboOut]   # combos your pool is one card away from
    cards: list[DeckCardOut]


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
    detected_format: str | None = None


class SaveDeckRequest(BaseModel):
    name: str
    deck: GeneratedDeckResponse


class SavedDeckResponse(BaseModel):
    id: str
    name: str
    deck: GeneratedDeckResponse
    created_at: str
    updated_at: str


class SavedDeckSummary(BaseModel):
    id: str
    name: str
    commander_name: str
    color_identity: list[str]
    total: int
    created_at: str
    updated_at: str
