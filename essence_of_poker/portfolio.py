"""NLHE portfolio assets from hero's two cards and the five-card board."""

from dataclasses import dataclass
from enum import IntEnum
from itertools import combinations

from essence_of_poker.assets import Asset, empty_asset
from essence_of_poker.cards import FULL_DECK, Card
from essence_of_poker.hand_buckets import HandBucket, bucket_key, evaluate_five_card_hand, five_card_buckets


class PortfolioCategory(IntEnum):
    ZERO = 0
    CARD_1 = 1
    CARD_2 = 2
    CARD_1_PLUS_CARD_2 = 3


@dataclass(frozen=True)
class PortfolioAssetDefinition:
    code: str
    category: PortfolioCategory
    name: str
    positions: tuple[str, str, str, str, str]


@dataclass(frozen=True)
class PortfolioAggregateDefinition:
    code: str
    name: str
    asset_codes: tuple[str, ...]
    category: PortfolioCategory | None = None


@dataclass(frozen=True)
class PortfolioAsset:
    definition: PortfolioAssetDefinition
    asset: Asset


@dataclass(frozen=True)
class Portfolio:
    assets: tuple[PortfolioAsset, ...]

    @property
    def zero_category(self) -> tuple[PortfolioAsset, ...]:
        return self._assets_in_category(PortfolioCategory.ZERO)

    @property
    def card_1_category(self) -> tuple[PortfolioAsset, ...]:
        return self._assets_in_category(PortfolioCategory.CARD_1)

    @property
    def card_2_category(self) -> tuple[PortfolioAsset, ...]:
        return self._assets_in_category(PortfolioCategory.CARD_2)

    @property
    def card_1_plus_card_2_category(self) -> tuple[PortfolioAsset, ...]:
        return self._assets_in_category(PortfolioCategory.CARD_1_PLUS_CARD_2)

    def _assets_in_category(self, category: PortfolioCategory) -> tuple[PortfolioAsset, ...]:
        return tuple(asset for asset in self.assets if asset.definition.category == category)


_PORTFOLIO_DEFINITIONS_UNSORTED: tuple[PortfolioAssetDefinition, ...] = (
    PortfolioAssetDefinition(
        "1.1",
        PortfolioCategory.ZERO,
        "F_1 + F_2 + F_3 + T + R",
        ("flop_1", "flop_2", "flop_3", "turn", "river"),
    ),
    PortfolioAssetDefinition(
        "2.1",
        PortfolioCategory.CARD_1,
        "H_1 + F_1 + F_2 + F_3 + T",
        ("hole_1", "flop_1", "flop_2", "flop_3", "turn"),
    ),
    PortfolioAssetDefinition(
        "2.2",
        PortfolioCategory.CARD_1,
        "H_1 + F_1 + F_2 + F_3 + R",
        ("hole_1", "flop_1", "flop_2", "flop_3", "river"),
    ),
    PortfolioAssetDefinition(
        "2.3",
        PortfolioCategory.CARD_1,
        "H_1 + F_1 + F_2 + T + R",
        ("hole_1", "flop_1", "flop_2", "turn", "river"),
    ),
    PortfolioAssetDefinition(
        "2.4",
        PortfolioCategory.CARD_1,
        "H_1 + F_1 + F_3 + T + R",
        ("hole_1", "flop_1", "flop_3", "turn", "river"),
    ),
    PortfolioAssetDefinition(
        "2.5",
        PortfolioCategory.CARD_1,
        "H_1 + F_2 + F_3 + T + R",
        ("hole_1", "flop_2", "flop_3", "turn", "river"),
    ),
    PortfolioAssetDefinition(
        "3.1",
        PortfolioCategory.CARD_2,
        "H_2 + F_1 + F_2 + F_3 + T",
        ("hole_2", "flop_1", "flop_2", "flop_3", "turn"),
    ),
    PortfolioAssetDefinition(
        "3.2",
        PortfolioCategory.CARD_2,
        "H_2 + F_1 + F_2 + F_3 + R",
        ("hole_2", "flop_1", "flop_2", "flop_3", "river"),
    ),
    PortfolioAssetDefinition(
        "3.3",
        PortfolioCategory.CARD_2,
        "H_2 + F_1 + F_2 + T + R",
        ("hole_2", "flop_1", "flop_2", "turn", "river"),
    ),
    PortfolioAssetDefinition(
        "3.4",
        PortfolioCategory.CARD_2,
        "H_2 + F_1 + F_3 + T + R",
        ("hole_2", "flop_1", "flop_3", "turn", "river"),
    ),
    PortfolioAssetDefinition(
        "3.5",
        PortfolioCategory.CARD_2,
        "H_2 + F_2 + F_3 + T + R",
        ("hole_2", "flop_2", "flop_3", "turn", "river"),
    ),
    PortfolioAssetDefinition(
        "4.1",
        PortfolioCategory.CARD_1_PLUS_CARD_2,
        "H_1 + H_2 + F_1 + F_2 + F_3",
        ("hole_1", "hole_2", "flop_1", "flop_2", "flop_3"),
    ),
    PortfolioAssetDefinition(
        "4.2",
        PortfolioCategory.CARD_1_PLUS_CARD_2,
        "H_1 + H_2 + F_1 + F_2 + T",
        ("hole_1", "hole_2", "flop_1", "flop_2", "turn"),
    ),
    PortfolioAssetDefinition(
        "4.3",
        PortfolioCategory.CARD_1_PLUS_CARD_2,
        "H_1 + H_2 + F_1 + F_2 + R",
        ("hole_1", "hole_2", "flop_1", "flop_2", "river"),
    ),
    PortfolioAssetDefinition(
        "4.4",
        PortfolioCategory.CARD_1_PLUS_CARD_2,
        "H_1 + H_2 + F_1 + F_3 + T",
        ("hole_1", "hole_2", "flop_1", "flop_3", "turn"),
    ),
    PortfolioAssetDefinition(
        "4.5",
        PortfolioCategory.CARD_1_PLUS_CARD_2,
        "H_1 + H_2 + F_1 + F_3 + R",
        ("hole_1", "hole_2", "flop_1", "flop_3", "river"),
    ),
    PortfolioAssetDefinition(
        "4.6",
        PortfolioCategory.CARD_1_PLUS_CARD_2,
        "H_1 + H_2 + F_1 + T + R",
        ("hole_1", "hole_2", "flop_1", "turn", "river"),
    ),
    PortfolioAssetDefinition(
        "4.7",
        PortfolioCategory.CARD_1_PLUS_CARD_2,
        "H_1 + H_2 + F_2 + F_3 + T",
        ("hole_1", "hole_2", "flop_2", "flop_3", "turn"),
    ),
    PortfolioAssetDefinition(
        "4.8",
        PortfolioCategory.CARD_1_PLUS_CARD_2,
        "H_1 + H_2 + F_2 + F_3 + R",
        ("hole_1", "hole_2", "flop_2", "flop_3", "river"),
    ),
    PortfolioAssetDefinition(
        "4.9",
        PortfolioCategory.CARD_1_PLUS_CARD_2,
        "H_1 + H_2 + F_2 + T + R",
        ("hole_1", "hole_2", "flop_2", "turn", "river"),
    ),
    PortfolioAssetDefinition(
        "4.10",
        PortfolioCategory.CARD_1_PLUS_CARD_2,
        "H_1 + H_2 + F_3 + T + R",
        ("hole_1", "hole_2", "flop_3", "turn", "river"),
    ),
)


_CATEGORY_SORT_ORDER = {
    PortfolioCategory.ZERO: 0,
    PortfolioCategory.CARD_1: 1,
    PortfolioCategory.CARD_2: 2,
    PortfolioCategory.CARD_1_PLUS_CARD_2: 3,
}

_COMPLETION_STREET_SORT_ORDER = {"F": 0, "T": 1, "R": 2}


def completion_street_for_definition(definition: PortfolioAssetDefinition) -> str:
    """Return the street on which a five-slot asset first becomes complete."""
    if "river" in definition.positions:
        return "R"
    if "turn" in definition.positions:
        return "T"
    return "F"


def portfolio_definition_sort_key(
    indexed_definition: tuple[int, PortfolioAssetDefinition],
) -> tuple[int, int, int]:
    original_index, definition = indexed_definition
    return (
        _CATEGORY_SORT_ORDER[definition.category],
        _COMPLETION_STREET_SORT_ORDER[completion_street_for_definition(definition)],
        original_index,
    )


PORTFOLIO_DEFINITIONS: tuple[PortfolioAssetDefinition, ...] = tuple(
    definition
    for _, definition in sorted(
        enumerate(_PORTFOLIO_DEFINITIONS_UNSORTED),
        key=portfolio_definition_sort_key,
    )
)


VILLAIN_PORTFOLIO_DEFINITIONS: tuple[PortfolioAssetDefinition, ...] = tuple(
    PortfolioAssetDefinition(
        definition.code,
        definition.category,
        definition.name.replace("H_1", "V_1").replace("H_2", "V_2"),
        tuple(
            position.replace("hole_1", "villain_1").replace("hole_2", "villain_2")
            for position in definition.positions
        ),
    )
    for definition in PORTFOLIO_DEFINITIONS
)


PORTFOLIO_AGGREGATE_DEFINITIONS: tuple[PortfolioAggregateDefinition, ...] = (
    PortfolioAggregateDefinition(
        "AGG",
        "Hand Aggregate",
        tuple(definition.code for definition in PORTFOLIO_DEFINITIONS),
    ),
    PortfolioAggregateDefinition(
        "AGG_BOTH",
        "Both hole cards aggregate",
        tuple(
            definition.code
            for definition in PORTFOLIO_DEFINITIONS
            if definition.category == PortfolioCategory.CARD_1_PLUS_CARD_2
        ),
        PortfolioCategory.CARD_1_PLUS_CARD_2,
    ),
    PortfolioAggregateDefinition(
        "AGG_H1",
        "First hole card aggregate",
        tuple(
            definition.code
            for definition in PORTFOLIO_DEFINITIONS
            if definition.category == PortfolioCategory.CARD_1
        ),
        PortfolioCategory.CARD_1,
    ),
    PortfolioAggregateDefinition(
        "AGG_H2",
        "Second hole card aggregate",
        tuple(
            definition.code
            for definition in PORTFOLIO_DEFINITIONS
            if definition.category == PortfolioCategory.CARD_2
        ),
        PortfolioCategory.CARD_2,
    ),
    PortfolioAggregateDefinition(
        "AGG_ZERO",
        "Only community cards aggregate",
        tuple(
            definition.code
            for definition in PORTFOLIO_DEFINITIONS
            if definition.category == PortfolioCategory.ZERO
        ),
        PortfolioCategory.ZERO,
    ),
)


def build_nlhe_portfolio(
    hole_cards: tuple[Card, Card],
    community_cards: tuple[Card, Card, Card, Card, Card],
) -> Portfolio:
    """Build hero's 21 five-card NLHE portfolio assets."""
    known_cards = hole_cards + community_cards
    if len(set(known_cards)) != 7:
        raise ValueError("portfolio cannot contain duplicate known cards")

    partial_deck = tuple(card for card in FULL_DECK if card not in set(known_cards))
    card_by_position = {
        "hole_1": hole_cards[0],
        "hole_2": hole_cards[1],
        "flop_1": community_cards[0],
        "flop_2": community_cards[1],
        "flop_3": community_cards[2],
        "turn": community_cards[3],
        "river": community_cards[4],
    }

    return Portfolio(
        tuple(
            PortfolioAsset(
                definition=definition,
                asset=Asset(
                    tuple(card_by_position[position] for position in definition.positions),
                    partial_deck,
                ),
            )
            for definition in PORTFOLIO_DEFINITIONS
        )
    )


def build_prior_nlhe_portfolio() -> Portfolio:
    """Build the 21-asset NLHE portfolio before any cards are dealt."""
    return Portfolio(
        tuple(
            PortfolioAsset(definition=definition, asset=empty_asset())
            for definition in PORTFOLIO_DEFINITIONS
        )
    )


def build_prior_villain_portfolio() -> Portfolio:
    """Build the 21-asset villain portfolio before hidden cards are dealt."""
    return Portfolio(
        tuple(
            PortfolioAsset(definition=definition, asset=empty_asset())
            for definition in VILLAIN_PORTFOLIO_DEFINITIONS
        )
    )


def aggregate_bucket_distribution(
    *,
    known_cards_by_position: dict[str, Card],
    partial_deck: tuple[Card, ...],
    definitions: tuple[PortfolioAssetDefinition, ...] = PORTFOLIO_DEFINITIONS,
    aggregate: PortfolioAggregateDefinition | None = None,
) -> dict[HandBucket, int]:
    """Count best-five-card outcomes by taking the minimum asset in each completion.

    This is the exact portfolio aggregate: every completed seven-card state is
    evaluated once, all 21 five-card assets are scored inside that same state,
    and the best gradation among them receives one count.
    """
    buckets = five_card_buckets()
    counts = {bucket: 0 for bucket in buckets}
    key_to_bucket = {bucket_key(bucket): bucket for bucket in buckets}
    missing_positions = tuple(
        position
        for position in ("hole_1", "hole_2", "flop_1", "flop_2", "flop_3", "turn", "river")
        if position not in known_cards_by_position
    )

    if len(set(known_cards_by_position.values())) != len(known_cards_by_position):
        raise ValueError("aggregate known cards cannot contain duplicates")
    if len(set(partial_deck)) != len(partial_deck):
        raise ValueError("aggregate partial deck cannot contain duplicates")
    if set(known_cards_by_position.values()).intersection(partial_deck):
        raise ValueError("aggregate known cards cannot also be in the partial deck")

    aggregate_codes = set(aggregate.asset_codes) if aggregate else None
    aggregate_definitions = tuple(
        definition for definition in definitions if aggregate_codes is None or definition.code in aggregate_codes
    )

    for drawn_cards in combinations(partial_deck, len(missing_positions)):
        completed = dict(known_cards_by_position)
        completed.update(zip(missing_positions, drawn_cards))
        best_key = min(
            evaluate_five_card_hand(tuple(completed[position] for position in definition.positions))
            for definition in aggregate_definitions
        )
        counts[key_to_bucket[best_key]] += 1

    return counts
