"""Deal two Texas Hold'em hole cards."""

import random
from dataclasses import dataclass, field

from essence_of_poker.cards import (
    Card,
    DealtCard,
    FULL_DECK,
    Round,
    Suit,
    extend_relative_suit_map,
    hero_hole_suit_map,
    ordered_dealt_cards,
    sort_cards,
)
from essence_of_poker.ranks import Rank, rank_to_symbol


SUIT_SYMBOLS: dict[Suit, str] = {
    Suit.SPADES: "s",
    Suit.HEARTS: "h",
    Suit.DIAMONDS: "d",
    Suit.CLUBS: "c",
}

def card_to_symbol(card: Card | DealtCard) -> str:
    return f"{rank_to_symbol(card.rank)}{SUIT_SYMBOLS[card.suit]}"


def draw_cards(deck: list[Card], count: int) -> tuple[Card, ...]:
    cards = tuple(random.sample(deck, count))
    for card in cards:
        deck.remove(card)
    return cards


def deal_hole_cards() -> tuple[Card, Card]:
    deck = list(FULL_DECK)
    return sort_cards(draw_cards(deck, 2))


def deal_our_hole_cards() -> tuple[DealtCard, DealtCard]:
    cards = deal_hole_cards()
    return ordered_dealt_cards(
        cards,
        round=Round.PREFLOP,
        player=1,
        relative_suits=hero_hole_suit_map(cards),
    )


@dataclass
class HandDeal:
    deck: list[Card] = field(default_factory=lambda: list(FULL_DECK))
    relative_suits: dict[Suit, int] = field(default_factory=dict)

    def deal_our_hole_cards(self) -> tuple[DealtCard, DealtCard]:
        cards = draw_cards(self.deck, 2)
        self.relative_suits = hero_hole_suit_map(cards)
        return ordered_dealt_cards(
            cards,
            round=Round.PREFLOP,
            player=1,
            relative_suits=self.relative_suits,
        )

    def deal_flop(self) -> tuple[DealtCard, DealtCard, DealtCard]:
        cards = draw_cards(self.deck, 3)
        self.relative_suits = extend_relative_suit_map(cards, self.relative_suits)
        return ordered_dealt_cards(
            cards,
            round=Round.FLOP,
            player=0,
            relative_suits=self.relative_suits,
        )

    def deal_turn(self) -> DealtCard:
        return self._deal_single_board_card(Round.TURN)

    def deal_river(self) -> DealtCard:
        return self._deal_single_board_card(Round.RIVER)

    def _deal_single_board_card(self, round: Round) -> DealtCard:
        cards = draw_cards(self.deck, 1)
        self.relative_suits = extend_relative_suit_map(cards, self.relative_suits)
        return ordered_dealt_cards(
            cards,
            round=round,
            player=0,
            relative_suits=self.relative_suits,
        )[0]


def main() -> None:
    hand = HandDeal()
    hole = hand.deal_our_hole_cards()
    flop = hand.deal_flop()
    turn = hand.deal_turn()
    river = hand.deal_river()
    print(" ".join(card_to_symbol(card) for card in (*hole, *flop, turn, river)))


if __name__ == "__main__":
    main()
