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


class PrintingOut(BaseModel):
    """One owned printing (physical inventory unit) of a card."""
    printing_key: str
    edition: str | None = None
    collector_number: str | None = None
    finish: str = "nonfoil"        # "foil" | "nonfoil"
    condition: str | None = None
    language: str | None = None
    count: int = 1
    purchase_price: float | None = None
    added_at: str | None = None    # ISO timestamp; stamped on import/add going forward


class CollectionCardOut(BaseModel):
    """One owned oracle card for the collection browser: oracle data + printings."""
    oracle_id: str
    name: str
    mana_cost: str = ""
    cmc: float = 0.0
    type_line: str = ""
    color_identity: list[str] = []
    oracle_text: str = ""
    total_count: int
    printings: list[PrintingOut] = []


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
    printings: list[PrintingOut] = []          # owned printings (empty for basics)
    selected_printing_key: str | None = None   # which owned copy this deck earmarks


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
    strategy: str | None = None
    theme: str | None = None
    theme_count: int = 0


class CollectionItemOut(BaseModel):
    oracle_id: str | None
    name: str
    count: int
    edition: str | None = None
    condition: str | None = None
    foil: str | None = None


class CardSearchResult(BaseModel):
    oracle_id: str
    name: str
    type_line: str
    mana_cost: str


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


class UpdateDeckRequest(BaseModel):
    name: str | None = None
    deck: GeneratedDeckResponse | None = None


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
