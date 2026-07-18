"""Five-card poker hand strength buckets."""

from collections import Counter
from dataclasses import dataclass
from enum import IntEnum
from functools import cache
from itertools import combinations

from essence_of_poker.cards import FULL_DECK, Card
from essence_of_poker.ranks import Rank, rank_to_symbol


class HandCategory(IntEnum):
    STRAIGHT_FLUSH = 1
    FOUR_OF_A_KIND = 2
    FULL_HOUSE = 3
    FLUSH = 4
    STRAIGHT = 5
    THREE_OF_A_KIND = 6
    TWO_PAIR = 7
    ONE_PAIR = 8
    HIGH_CARD = 9


CATEGORY_NAMES: dict[HandCategory, str] = {
    HandCategory.STRAIGHT_FLUSH: "Straight flush",
    HandCategory.FOUR_OF_A_KIND: "Four of a kind",
    HandCategory.FULL_HOUSE: "Full house",
    HandCategory.FLUSH: "Flush",
    HandCategory.STRAIGHT: "Straight",
    HandCategory.THREE_OF_A_KIND: "Three of a kind",
    HandCategory.TWO_PAIR: "Two pair",
    HandCategory.ONE_PAIR: "One pair",
    HandCategory.HIGH_CARD: "High card",
}

STRAIGHTS: tuple[tuple[Rank, ...], ...] = (
    (Rank.ACE, Rank.KING, Rank.QUEEN, Rank.JACK, Rank.TEN),
    (Rank.KING, Rank.QUEEN, Rank.JACK, Rank.TEN, Rank.NINE),
    (Rank.QUEEN, Rank.JACK, Rank.TEN, Rank.NINE, Rank.EIGHT),
    (Rank.JACK, Rank.TEN, Rank.NINE, Rank.EIGHT, Rank.SEVEN),
    (Rank.TEN, Rank.NINE, Rank.EIGHT, Rank.SEVEN, Rank.SIX),
    (Rank.NINE, Rank.EIGHT, Rank.SEVEN, Rank.SIX, Rank.FIVE),
    (Rank.EIGHT, Rank.SEVEN, Rank.SIX, Rank.FIVE, Rank.FOUR),
    (Rank.SEVEN, Rank.SIX, Rank.FIVE, Rank.FOUR, Rank.THREE),
    (Rank.SIX, Rank.FIVE, Rank.FOUR, Rank.THREE, Rank.TWO),
    (Rank.FIVE, Rank.FOUR, Rank.THREE, Rank.TWO, Rank.ACE),
)

STRAIGHT_ORDER = {frozenset(straight): index for index, straight in enumerate(STRAIGHTS)}


@dataclass(frozen=True)
class HandBucket:
    gradation: int
    category: HandCategory
    category_name: str
    ranks: tuple[Rank, ...]
    name: str
    subcategory_name: str
    subsubcategory_name: str


def evaluate_five_card_hand(cards: tuple[Card, Card, Card, Card, Card]) -> tuple:
    """Return a best-to-worst sortable key for a five-card poker hand."""
    ranks = tuple(sorted(card.rank for card in cards))
    suits = {card.suit for card in cards}
    counts = Counter(ranks)
    by_count = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    straight_index = STRAIGHT_ORDER.get(frozenset(ranks))
    is_flush = len(suits) == 1

    if straight_index is not None and is_flush:
        return (HandCategory.STRAIGHT_FLUSH, straight_index)

    if by_count[0][1] == 4:
        quad_rank = by_count[0][0]
        kicker = next(rank for rank in ranks if rank != quad_rank)
        return (HandCategory.FOUR_OF_A_KIND, quad_rank, kicker)

    if by_count[0][1] == 3 and by_count[1][1] == 2:
        return (HandCategory.FULL_HOUSE, by_count[0][0], by_count[1][0])

    if is_flush:
        return (HandCategory.FLUSH, *ranks)

    if straight_index is not None:
        return (HandCategory.STRAIGHT, straight_index)

    if by_count[0][1] == 3:
        trip_rank = by_count[0][0]
        kickers = tuple(rank for rank in ranks if rank != trip_rank)
        return (HandCategory.THREE_OF_A_KIND, trip_rank, *kickers)

    if by_count[0][1] == 2 and by_count[1][1] == 2:
        pair_ranks = tuple(rank for rank, count in by_count if count == 2)
        kicker = next(rank for rank in ranks if rank not in pair_ranks)
        return (HandCategory.TWO_PAIR, *pair_ranks, kicker)

    if by_count[0][1] == 2:
        pair_rank = by_count[0][0]
        kickers = tuple(rank for rank in ranks if rank != pair_rank)
        return (HandCategory.ONE_PAIR, pair_rank, *kickers)

    return (HandCategory.HIGH_CARD, *ranks)


@cache
def count_hand_buckets(available_cards: tuple[Card, ...] = FULL_DECK) -> dict[HandBucket, int]:
    """Count available five-card combinations in each of the 7,462 buckets."""
    buckets = five_card_buckets()
    counts = {bucket: 0 for bucket in buckets}
    key_to_bucket = {bucket_key(bucket): bucket for bucket in buckets}

    for cards in combinations(available_cards, 5):
        counts[key_to_bucket[evaluate_five_card_hand(cards)]] += 1

    return counts


@cache
def five_card_buckets() -> tuple[HandBucket, ...]:
    """Return all distinct five-card hand gradations from best to worst."""
    keys = tuple(_bucket_keys())
    return tuple(_bucket_from_key(index, key) for index, key in enumerate(keys, start=1))


def _bucket_keys() -> tuple[tuple, ...]:
    rank_combinations = tuple(combinations(tuple(Rank), 5))
    nonstraight_rank_combinations = tuple(
        ranks for ranks in rank_combinations if frozenset(ranks) not in STRAIGHT_ORDER
    )

    keys: list[tuple] = []

    keys.extend((HandCategory.STRAIGHT_FLUSH, index) for index in range(len(STRAIGHTS)))

    for quad_rank in Rank:
        keys.extend(
            (HandCategory.FOUR_OF_A_KIND, quad_rank, kicker)
            for kicker in Rank
            if kicker != quad_rank
        )

    for trip_rank in Rank:
        keys.extend(
            (HandCategory.FULL_HOUSE, trip_rank, pair_rank)
            for pair_rank in Rank
            if pair_rank != trip_rank
        )

    keys.extend((HandCategory.FLUSH, *ranks) for ranks in nonstraight_rank_combinations)
    keys.extend((HandCategory.STRAIGHT, index) for index in range(len(STRAIGHTS)))

    for trip_rank in Rank:
        keys.extend(
            (HandCategory.THREE_OF_A_KIND, trip_rank, *kickers)
            for kickers in combinations(tuple(rank for rank in Rank if rank != trip_rank), 2)
        )

    for pair_ranks in combinations(tuple(Rank), 2):
        keys.extend(
            (HandCategory.TWO_PAIR, *pair_ranks, kicker)
            for kicker in Rank
            if kicker not in pair_ranks
        )

    for pair_rank in Rank:
        keys.extend(
            (HandCategory.ONE_PAIR, pair_rank, *kickers)
            for kickers in combinations(tuple(rank for rank in Rank if rank != pair_rank), 3)
        )

    keys.extend((HandCategory.HIGH_CARD, *ranks) for ranks in nonstraight_rank_combinations)

    return tuple(keys)


def bucket_key(bucket: HandBucket) -> tuple:
    return (bucket.category, *_rank_key_values(bucket))


def _rank_key_values(bucket: HandBucket) -> tuple[int, ...]:
    if bucket.category in (HandCategory.STRAIGHT_FLUSH, HandCategory.STRAIGHT):
        return (STRAIGHT_ORDER[frozenset(bucket.ranks)],)
    return tuple(bucket.ranks)


def _bucket_from_key(gradation: int, key: tuple) -> HandBucket:
    category = HandCategory(key[0])
    ranks = _ranks_from_key(category, key[1:])
    category_name = CATEGORY_NAMES[category]
    return HandBucket(
        gradation=gradation,
        category=category,
        category_name=category_name,
        ranks=ranks,
        name=_bucket_name(category, ranks),
        subcategory_name=_subcategory_name(category, ranks),
        subsubcategory_name=_subsubcategory_name(category, ranks),
    )


def _ranks_from_key(category: HandCategory, values: tuple) -> tuple[Rank, ...]:
    if category in (HandCategory.STRAIGHT_FLUSH, HandCategory.STRAIGHT):
        return STRAIGHTS[values[0]]
    return tuple(Rank(value) for value in values)


def _bucket_name(category: HandCategory, ranks: tuple[Rank, ...]) -> str:
    category_name = CATEGORY_NAMES[category]
    rank_text = "-".join(rank_to_symbol(rank) for rank in ranks)

    if category == HandCategory.STRAIGHT_FLUSH:
        return f"{rank_to_symbol(ranks[0])}-high straight flush"
    if category == HandCategory.FOUR_OF_A_KIND:
        return f"Four {rank_to_symbol(ranks[0])}s with {rank_to_symbol(ranks[1])} kicker"
    if category == HandCategory.FULL_HOUSE:
        return f"Full house, {rank_to_symbol(ranks[0])}s full of {rank_to_symbol(ranks[1])}s"
    if category == HandCategory.FLUSH:
        return f"{rank_text} flush"
    if category == HandCategory.STRAIGHT:
        return f"{rank_to_symbol(ranks[0])}-high straight"
    if category == HandCategory.THREE_OF_A_KIND:
        return f"Three {rank_to_symbol(ranks[0])}s with {rank_to_symbol(ranks[1])}-{rank_to_symbol(ranks[2])}"
    if category == HandCategory.TWO_PAIR:
        return f"Two pair, {rank_to_symbol(ranks[0])}s and {rank_to_symbol(ranks[1])}s with {rank_to_symbol(ranks[2])}"
    if category == HandCategory.ONE_PAIR:
        return f"Pair of {rank_to_symbol(ranks[0])}s with {rank_to_symbol(ranks[1])}-{rank_to_symbol(ranks[2])}-{rank_to_symbol(ranks[3])}"
    if category == HandCategory.HIGH_CARD:
        return f"{rank_text} high"

    return category_name


def _subcategory_name(category: HandCategory, ranks: tuple[Rank, ...]) -> str:
    if category in (HandCategory.STRAIGHT_FLUSH, HandCategory.STRAIGHT, HandCategory.HIGH_CARD):
        return f"{rank_to_symbol(ranks[0])}-high"
    if category == HandCategory.FOUR_OF_A_KIND:
        return f"Four {rank_to_symbol(ranks[0])}s"
    if category == HandCategory.FULL_HOUSE:
        return f"{rank_to_symbol(ranks[0])}s full"
    if category == HandCategory.FLUSH:
        return f"{rank_to_symbol(ranks[0])}-high"
    if category == HandCategory.THREE_OF_A_KIND:
        return f"Three {rank_to_symbol(ranks[0])}s"
    if category == HandCategory.TWO_PAIR:
        return f"{rank_to_symbol(ranks[0])}s up"
    if category == HandCategory.ONE_PAIR:
        return f"Pair of {rank_to_symbol(ranks[0])}s"
    return CATEGORY_NAMES[category]


def _subsubcategory_name(category: HandCategory, ranks: tuple[Rank, ...]) -> str:
    if len(ranks) == 1:
        return _subcategory_name(category, ranks)

    if category == HandCategory.FULL_HOUSE:
        return f"{rank_to_symbol(ranks[0])}s full of {rank_to_symbol(ranks[1])}s"
    if category == HandCategory.TWO_PAIR:
        return f"{rank_to_symbol(ranks[0])}s and {rank_to_symbol(ranks[1])}s"
    if category == HandCategory.ONE_PAIR:
        return f"Pair of {rank_to_symbol(ranks[0])}s, {rank_to_symbol(ranks[1])} kicker"

    return "-".join(rank_to_symbol(rank) for rank in ranks[:2])
