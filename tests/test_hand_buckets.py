import math
import unittest

from essence_of_poker.cards import Card, Suit
from essence_of_poker.hand_buckets import (
    FULL_DECK,
    HandCategory,
    count_hand_buckets,
    evaluate_five_card_hand,
    five_card_buckets,
)
from essence_of_poker.ranks import Rank


class HandBucketTests(unittest.TestCase):
    def test_evaluate_five_card_hand_uses_best_to_worst_categories(self) -> None:
        straight_flush = (
            Card(Rank.ACE, Suit.SPADES),
            Card(Rank.KING, Suit.SPADES),
            Card(Rank.QUEEN, Suit.SPADES),
            Card(Rank.JACK, Suit.SPADES),
            Card(Rank.TEN, Suit.SPADES),
        )
        quads = (
            Card(Rank.ACE, Suit.SPADES),
            Card(Rank.ACE, Suit.HEARTS),
            Card(Rank.ACE, Suit.DIAMONDS),
            Card(Rank.ACE, Suit.CLUBS),
            Card(Rank.KING, Suit.SPADES),
        )

        self.assertLess(evaluate_five_card_hand(straight_flush), evaluate_five_card_hand(quads))

    def test_five_card_buckets_have_7462_gradations(self) -> None:
        buckets = five_card_buckets()

        self.assertEqual(len(buckets), 7462)
        self.assertEqual(buckets[0].gradation, 1)
        self.assertEqual(buckets[-1].gradation, 7462)

    def test_five_card_buckets_are_ordered_highest_to_lowest(self) -> None:
        buckets = five_card_buckets()

        self.assertEqual(buckets[0].category, HandCategory.STRAIGHT_FLUSH)
        self.assertEqual(buckets[0].name, "A-high straight flush")
        self.assertEqual(buckets[-1].category, HandCategory.HIGH_CARD)
        self.assertEqual(buckets[-1].name, "7-5-4-3-2 high")

    def test_bucket_names_include_subcategories_and_subsubcategories(self) -> None:
        buckets = five_card_buckets()
        full_house = next(
            bucket
            for bucket in buckets
            if bucket.category == HandCategory.FULL_HOUSE
            and bucket.ranks == (Rank.SIX, Rank.KING)
        )
        pair = next(
            bucket
            for bucket in buckets
            if bucket.category == HandCategory.ONE_PAIR
            and bucket.ranks == (Rank.FOUR, Rank.ACE, Rank.KING, Rank.QUEEN)
        )
        high_card = next(
            bucket
            for bucket in buckets
            if bucket.category == HandCategory.HIGH_CARD
            and bucket.ranks == (Rank.ACE, Rank.KING, Rank.JACK, Rank.EIGHT, Rank.TWO)
        )

        self.assertEqual(full_house.subcategory_name, "6s full")
        self.assertEqual(full_house.subsubcategory_name, "6s full of Ks")
        self.assertEqual(pair.subcategory_name, "Pair of 4s")
        self.assertEqual(high_card.subsubcategory_name, "A-K")
        self.assertEqual(high_card.name, "A-K-J-8-2 high")

    def test_full_deck_counts_sum_to_all_five_card_combos(self) -> None:
        counts = count_hand_buckets(FULL_DECK)

        self.assertEqual(sum(counts.values()), math.comb(52, 5))
        self.assertEqual(len(counts), 7462)

    def test_full_deck_category_counts(self) -> None:
        counts = count_hand_buckets(FULL_DECK)
        category_counts = {
            category: sum(count for bucket, count in counts.items() if bucket.category == category)
            for category in HandCategory
        }

        self.assertEqual(category_counts[HandCategory.STRAIGHT_FLUSH], 40)
        self.assertEqual(category_counts[HandCategory.FOUR_OF_A_KIND], 624)
        self.assertEqual(category_counts[HandCategory.FULL_HOUSE], 3744)
        self.assertEqual(category_counts[HandCategory.FLUSH], 5108)
        self.assertEqual(category_counts[HandCategory.STRAIGHT], 10200)
        self.assertEqual(category_counts[HandCategory.THREE_OF_A_KIND], 54912)
        self.assertEqual(category_counts[HandCategory.TWO_PAIR], 123552)
        self.assertEqual(category_counts[HandCategory.ONE_PAIR], 1098240)
        self.assertEqual(category_counts[HandCategory.HIGH_CARD], 1302540)


if __name__ == "__main__":
    unittest.main()

