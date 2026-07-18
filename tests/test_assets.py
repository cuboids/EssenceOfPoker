import unittest

from essence_of_poker.assets import Asset, asset_from_cards, empty_asset
from essence_of_poker.cards import FULL_DECK, Card, Suit
from essence_of_poker.hand_buckets import HandCategory
from essence_of_poker.ranks import Rank


class AssetTests(unittest.TestCase):
    def test_empty_asset_can_have_a_full_deck(self) -> None:
        asset = empty_asset()

        self.assertEqual(asset.slots, (None, None, None, None, None))
        self.assertEqual(asset.partial_deck, FULL_DECK)
        self.assertEqual(asset.filled_slots, ())
        self.assertEqual(asset.empty_slot_count, 5)

    def test_full_deck_asset_rejects_filled_slots(self) -> None:
        with self.assertRaises(ValueError):
            Asset(
                (
                    Card(Rank.ACE, Suit.SPADES),
                    None,
                    None,
                    None,
                    None,
                ),
                FULL_DECK,
            )

    def test_asset_must_have_five_slots(self) -> None:
        with self.assertRaises(ValueError):
            Asset((None, None, None, None), FULL_DECK)

    def test_asset_rejects_duplicate_slot_cards(self) -> None:
        card = Card(Rank.ACE, Suit.SPADES)

        with self.assertRaises(ValueError):
            Asset(
                (
                    card,
                    card,
                    None,
                    None,
                    None,
                ),
                tuple(deck_card for deck_card in FULL_DECK if deck_card != card),
            )

    def test_asset_rejects_duplicate_partial_deck_cards(self) -> None:
        card = Card(Rank.ACE, Suit.SPADES)

        with self.assertRaises(ValueError):
            Asset(
                (None, None, None, None, None),
                (card, card),
            )

    def test_asset_from_cards_removes_known_cards_from_full_deck(self) -> None:
        ace_spades = Card(Rank.ACE, Suit.SPADES)
        king_hearts = Card(Rank.KING, Suit.HEARTS)

        asset = asset_from_cards((ace_spades, king_hearts))

        self.assertEqual(asset.slots, (ace_spades, king_hearts, None, None, None))
        self.assertNotIn(ace_spades, asset.partial_deck)
        self.assertNotIn(king_hearts, asset.partial_deck)
        self.assertEqual(len(asset.partial_deck), 50)

    def test_asset_from_cards_rejects_more_than_five_cards(self) -> None:
        with self.assertRaises(ValueError):
            asset_from_cards(FULL_DECK[:6])

    def test_empty_asset_distribution_sums_to_all_five_card_combos(self) -> None:
        distribution = empty_asset().bucket_distribution()

        self.assertEqual(sum(distribution.values()), 2598960)
        self.assertEqual(len(distribution), 7462)

    def test_complete_asset_distribution_has_one_combo(self) -> None:
        asset = asset_from_cards(
            (
                Card(Rank.ACE, Suit.SPADES),
                Card(Rank.KING, Suit.SPADES),
                Card(Rank.QUEEN, Suit.SPADES),
                Card(Rank.JACK, Suit.SPADES),
                Card(Rank.TEN, Suit.SPADES),
            )
        )
        distribution = asset.bucket_distribution()
        nonzero = tuple((bucket, count) for bucket, count in distribution.items() if count)

        self.assertEqual(len(nonzero), 1)
        self.assertEqual(nonzero[0][0].category, HandCategory.STRAIGHT_FLUSH)
        self.assertEqual(nonzero[0][1], 1)


if __name__ == "__main__":
    unittest.main()
