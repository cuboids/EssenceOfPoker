"""Cards with poker context attributes."""

from dataclasses import dataclass
from enum import IntEnum

from essence_of_poker.ranks import Rank


class Game(IntEnum):
    NLHE = 1
    OMAHA = 2


class Round(IntEnum):
    PREFLOP = 1
    FLOP = 2
    TURN = 3
    RIVER = 4


class Suit(IntEnum):
    SPADES = 1
    HEARTS = 2
    DIAMONDS = 3
    CLUBS = 4


@dataclass(frozen=True)
class Card:
    rank: Rank
    suit: Suit


FULL_DECK = tuple(Card(rank, suit) for rank in Rank for suit in Suit)


def sort_cards(
    cards: tuple[Card, ...],
    relative_suits: dict[Suit, int] | None = None,
) -> tuple[Card, ...]:
    """Sort cards by rank first, then known relative suit or absolute suit."""
    return tuple(sorted(cards, key=lambda card: _sort_key(card, relative_suits)))


def _sort_key(card: Card, relative_suits: dict[Suit, int] | None) -> tuple[int, int]:
    if relative_suits and card.suit in relative_suits:
        suit_tiebreak = relative_suits[card.suit]
    else:
        suit_tiebreak = 100 + card.suit
    return (card.rank, suit_tiebreak)


@dataclass(frozen=True)
class DealtCard:
    game: Game
    hand_number: int
    round: Round
    player: int
    card_number: int
    rank: Rank
    suit: Suit
    relative_suit: int | None = None


def hero_hole_suit_map(cards: tuple[Card, Card]) -> dict[Suit, int]:
    """Map absolute suits to hero-relative suit labels from ordered hole cards."""
    card_1, card_2 = sort_cards(cards)
    if card_1.suit == card_2.suit:
        return {card_1.suit: 1}
    return {card_1.suit: 1, card_2.suit: 2}


def extend_relative_suit_map(
    cards: tuple[Card, ...],
    relative_suits: dict[Suit, int],
) -> dict[Suit, int]:
    """Assign new relative suit labels in sorted card order."""
    extended = dict(relative_suits)
    next_label = max(extended.values(), default=0) + 1

    for card in sort_cards(cards, extended):
        if card.suit not in extended:
            extended[card.suit] = next_label
            next_label += 1

    return extended


def ordered_dealt_cards(
    cards: tuple[Card, ...],
    *,
    game: Game = Game.NLHE,
    hand_number: int = 1,
    round: Round,
    player: int,
    relative_suits: dict[Suit, int] | None = None,
) -> tuple[DealtCard, ...]:
    """Attach context to cards after sorting by rank, then suit."""
    return tuple(
        DealtCard(
            game=game,
            hand_number=hand_number,
            round=round,
            player=player,
            card_number=index,
            rank=card.rank,
            suit=card.suit,
            relative_suit=None if relative_suits is None else relative_suits.get(card.suit),
        )
        for index, card in enumerate(sort_cards(cards, relative_suits), start=1)
    )
