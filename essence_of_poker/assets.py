"""Five-slot assets with an associated partial deck."""

from dataclasses import dataclass
from itertools import combinations

from essence_of_poker.cards import FULL_DECK, Card
from essence_of_poker.hand_buckets import HandBucket, bucket_key, evaluate_five_card_hand, five_card_buckets


AssetSlot = Card | None


@dataclass(frozen=True)
class Asset:
    slots: tuple[AssetSlot, AssetSlot, AssetSlot, AssetSlot, AssetSlot]
    partial_deck: tuple[Card, ...] = FULL_DECK

    def __post_init__(self) -> None:
        if len(self.slots) != 5:
            raise ValueError("an asset must have exactly five slots")

        filled_slots = tuple(card for card in self.slots if card is not None)

        if len(set(filled_slots)) != len(filled_slots):
            raise ValueError("an asset cannot contain duplicate cards in its slots")

        if len(set(self.partial_deck)) != len(self.partial_deck):
            raise ValueError("an asset partial deck cannot contain duplicate cards")

        overlap = set(filled_slots).intersection(self.partial_deck)
        if overlap:
            raise ValueError("an asset slot card cannot also exist in the partial deck")

    @property
    def filled_slots(self) -> tuple[Card, ...]:
        return tuple(card for card in self.slots if card is not None)

    @property
    def empty_slot_count(self) -> int:
        return sum(card is None for card in self.slots)

    def bucket_distribution(self) -> dict[HandBucket, int]:
        buckets = five_card_buckets()
        counts = {bucket: 0 for bucket in buckets}
        key_to_bucket = {bucket_key(bucket): bucket for bucket in buckets}
        filled_slots = self.filled_slots

        for drawn_cards in combinations(self.partial_deck, self.empty_slot_count):
            hand = filled_slots + drawn_cards
            counts[key_to_bucket[evaluate_five_card_hand(hand)]] += 1

        return counts


def empty_asset(partial_deck: tuple[Card, ...] = FULL_DECK) -> Asset:
    return Asset((None, None, None, None, None), partial_deck)


def asset_from_cards(
    cards: tuple[Card, ...],
    *,
    partial_deck: tuple[Card, ...] | None = None,
) -> Asset:
    if len(cards) > 5:
        raise ValueError("an asset cannot contain more than five cards")

    deck = partial_deck
    if deck is None:
        removed = set(cards)
        deck = tuple(card for card in FULL_DECK if card not in removed)

    return Asset(cards + (None,) * (5 - len(cards)), deck)
