import unittest

from essence_of_poker.cards import (
    Card,
    Game,
    Round,
    Suit,
    extend_relative_suit_map,
    hero_hole_suit_map,
    ordered_dealt_cards,
)
from essence_of_poker.ranks import Rank


class DealtCardTests(unittest.TestCase):
    def test_hero_hole_suit_map_uses_ordered_card_one_as_suit_one(self) -> None:
        suit_map = hero_hole_suit_map(
            (
                Card(Rank.KING, Suit.CLUBS),
                Card(Rank.ACE, Suit.HEARTS),
            )
        )

        self.assertEqual(suit_map, {Suit.HEARTS: 1, Suit.CLUBS: 2})

    def test_hero_hole_suit_map_keeps_suited_hands_as_suit_one(self) -> None:
        suit_map = hero_hole_suit_map(
            (
                Card(Rank.KING, Suit.HEARTS),
                Card(Rank.ACE, Suit.HEARTS),
            )
        )

        self.assertEqual(suit_map, {Suit.HEARTS: 1})

    def test_extend_relative_suit_map_assigns_new_suits_in_sorted_card_order(self) -> None:
        suit_map = extend_relative_suit_map(
            (
                Card(Rank.SEVEN, Suit.CLUBS),
                Card(Rank.ACE, Suit.DIAMONDS),
                Card(Rank.KING, Suit.SPADES),
            ),
            {Suit.HEARTS: 1},
        )

        self.assertEqual(
            suit_map,
            {
                Suit.HEARTS: 1,
                Suit.DIAMONDS: 2,
                Suit.SPADES: 3,
                Suit.CLUBS: 4,
            },
        )

    def test_flop_tiebreaks_unknown_suits_by_absolute_suit_after_known_suits(self) -> None:
        hole_suits = hero_hole_suit_map(
            (
                Card(Rank.SIX, Suit.CLUBS),
                Card(Rank.SEVEN, Suit.CLUBS),
            )
        )
        flop = (
            Card(Rank.ACE, Suit.CLUBS),
            Card(Rank.KING, Suit.DIAMONDS),
            Card(Rank.KING, Suit.SPADES),
        )
        suit_map = extend_relative_suit_map(flop, hole_suits)
        cards = ordered_dealt_cards(flop, round=Round.FLOP, player=0, relative_suits=suit_map)

        self.assertEqual([card.suit for card in cards], [Suit.CLUBS, Suit.SPADES, Suit.DIAMONDS])
        self.assertEqual([card.relative_suit for card in cards], [1, 2, 3])

    def test_flop_tiebreaks_known_relative_suits_before_new_suits(self) -> None:
        hole_suits = hero_hole_suit_map(
            (
                Card(Rank.SEVEN, Suit.DIAMONDS),
                Card(Rank.THREE, Suit.SPADES),
            )
        )
        flop = (
            Card(Rank.ACE, Suit.CLUBS),
            Card(Rank.KING, Suit.DIAMONDS),
            Card(Rank.KING, Suit.SPADES),
        )
        suit_map = extend_relative_suit_map(flop, hole_suits)
        cards = ordered_dealt_cards(flop, round=Round.FLOP, player=0, relative_suits=suit_map)

        self.assertEqual([card.suit for card in cards], [Suit.CLUBS, Suit.DIAMONDS, Suit.SPADES])
        self.assertEqual([card.relative_suit for card in cards], [3, 1, 2])

    def test_ordered_dealt_cards_are_numbered_best_first(self) -> None:
        cards = ordered_dealt_cards(
            (
                Card(Rank.SEVEN, Suit.CLUBS),
                Card(Rank.ACE, Suit.DIAMONDS),
                Card(Rank.KING, Suit.SPADES),
            ),
            round=Round.FLOP,
            player=0,
        )

        self.assertEqual([card.rank for card in cards], [Rank.ACE, Rank.KING, Rank.SEVEN])
        self.assertEqual([card.suit for card in cards], [Suit.DIAMONDS, Suit.SPADES, Suit.CLUBS])
        self.assertEqual([card.card_number for card in cards], [1, 2, 3])

    def test_ordered_dealt_cards_use_suit_as_rank_tiebreaker(self) -> None:
        cards = ordered_dealt_cards(
            (
                Card(Rank.KING, Suit.CLUBS),
                Card(Rank.KING, Suit.HEARTS),
            ),
            round=Round.PREFLOP,
            player=1,
        )

        self.assertEqual([card.suit for card in cards], [Suit.HEARTS, Suit.CLUBS])
        self.assertEqual([card.card_number for card in cards], [1, 2])

    def test_ordered_dealt_cards_can_include_relative_suits(self) -> None:
        cards = ordered_dealt_cards(
            (
                Card(Rank.KING, Suit.CLUBS),
                Card(Rank.ACE, Suit.HEARTS),
            ),
            round=Round.PREFLOP,
            player=1,
            relative_suits={Suit.HEARTS: 1, Suit.CLUBS: 2},
        )

        self.assertEqual([card.relative_suit for card in cards], [1, 2])

    def test_ordered_dealt_cards_defaults_to_nlhe_hand_one(self) -> None:
        (card,) = ordered_dealt_cards(
            (Card(Rank.TEN, Suit.SPADES),),
            round=Round.TURN,
            player=0,
        )

        self.assertEqual(card.game, Game.NLHE)
        self.assertEqual(card.hand_number, 1)
        self.assertEqual(card.round, Round.TURN)
        self.assertEqual(card.player, 0)
        self.assertEqual(card.card_number, 1)
        self.assertEqual(card.rank, Rank.TEN)
        self.assertEqual(card.suit, Suit.SPADES)


if __name__ == "__main__":
    unittest.main()
