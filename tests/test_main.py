import unittest
from unittest.mock import patch

from essence_of_poker.cards import Card, Game, Round, Suit
from essence_of_poker.main import HandDeal, card_to_symbol, deal_hole_cards, deal_our_hole_cards
from essence_of_poker.ranks import Rank


class MainTests(unittest.TestCase):
    def test_dealt_hole_cards_are_ordered_best_first(self) -> None:
        with patch("essence_of_poker.main.random.sample") as sample:
            sample.return_value = [
                Card(Rank.KING, Suit.SPADES),
                Card(Rank.ACE, Suit.CLUBS),
            ]

            self.assertEqual(
                deal_hole_cards(),
                (Card(Rank.ACE, Suit.CLUBS), Card(Rank.KING, Suit.SPADES)),
            )

    def test_dealt_hole_cards_use_suit_as_rank_tiebreaker(self) -> None:
        with patch("essence_of_poker.main.random.sample") as sample:
            sample.return_value = [
                Card(Rank.KING, Suit.CLUBS),
                Card(Rank.KING, Suit.HEARTS),
            ]

            self.assertEqual(
                deal_hole_cards(),
                (Card(Rank.KING, Suit.HEARTS), Card(Rank.KING, Suit.CLUBS)),
            )

    def test_dealt_hole_cards_include_context_attributes(self) -> None:
        with patch("essence_of_poker.main.random.sample") as sample:
            sample.return_value = [
                Card(Rank.KING, Suit.CLUBS),
                Card(Rank.KING, Suit.HEARTS),
            ]

            card_1, card_2 = deal_our_hole_cards()

        self.assertEqual(card_1.game, Game.NLHE)
        self.assertEqual(card_1.hand_number, 1)
        self.assertEqual(card_1.round, Round.PREFLOP)
        self.assertEqual(card_1.player, 1)
        self.assertEqual(card_1.card_number, 1)
        self.assertEqual(card_1.rank, Rank.KING)
        self.assertEqual(card_1.suit, Suit.HEARTS)
        self.assertEqual(card_1.relative_suit, 1)

        self.assertEqual(card_2.card_number, 2)
        self.assertEqual(card_2.rank, Rank.KING)
        self.assertEqual(card_2.suit, Suit.CLUBS)
        self.assertEqual(card_2.relative_suit, 2)

    def test_dealt_suited_hole_cards_share_relative_suit_one(self) -> None:
        with patch("essence_of_poker.main.random.sample") as sample:
            sample.return_value = [
                Card(Rank.KING, Suit.HEARTS),
                Card(Rank.ACE, Suit.HEARTS),
            ]

            card_1, card_2 = deal_our_hole_cards()

        self.assertEqual(card_1.relative_suit, 1)
        self.assertEqual(card_2.relative_suit, 1)

    def test_card_to_symbol(self) -> None:
        self.assertEqual(card_to_symbol(Card(Rank.KING, Suit.HEARTS)), "Kh")

    def test_hand_deal_orders_flop_and_assigns_new_relative_suits(self) -> None:
        hand = HandDeal()
        with patch("essence_of_poker.main.random.sample") as sample:
            sample.side_effect = [
                [
                    Card(Rank.ACE, Suit.HEARTS),
                    Card(Rank.KING, Suit.CLUBS),
                ],
                [
                    Card(Rank.SEVEN, Suit.SPADES),
                    Card(Rank.QUEEN, Suit.DIAMONDS),
                    Card(Rank.JACK, Suit.HEARTS),
                ],
            ]

            hand.deal_our_hole_cards()
            flop = hand.deal_flop()

        self.assertEqual([card.round for card in flop], [Round.FLOP, Round.FLOP, Round.FLOP])
        self.assertEqual([card.player for card in flop], [0, 0, 0])
        self.assertEqual([card.card_number for card in flop], [1, 2, 3])
        self.assertEqual([card.rank for card in flop], [Rank.QUEEN, Rank.JACK, Rank.SEVEN])
        self.assertEqual([card.suit for card in flop], [Suit.DIAMONDS, Suit.HEARTS, Suit.SPADES])
        self.assertEqual([card.relative_suit for card in flop], [3, 1, 4])

    def test_hand_deal_turn_and_river_are_single_board_cards(self) -> None:
        hand = HandDeal()
        with patch("essence_of_poker.main.random.sample") as sample:
            sample.side_effect = [
                [
                    Card(Rank.ACE, Suit.HEARTS),
                    Card(Rank.KING, Suit.CLUBS),
                ],
                [Card(Rank.TEN, Suit.DIAMONDS)],
                [Card(Rank.TWO, Suit.SPADES)],
            ]

            hand.deal_our_hole_cards()
            turn = hand.deal_turn()
            river = hand.deal_river()

        self.assertEqual(turn.round, Round.TURN)
        self.assertEqual(turn.player, 0)
        self.assertEqual(turn.card_number, 1)
        self.assertEqual(turn.relative_suit, 3)

        self.assertEqual(river.round, Round.RIVER)
        self.assertEqual(river.player, 0)
        self.assertEqual(river.card_number, 1)
        self.assertEqual(river.relative_suit, 4)


if __name__ == "__main__":
    unittest.main()
