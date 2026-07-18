import unittest

from essence_of_poker.cards import FULL_DECK, Card, Suit
from essence_of_poker.portfolio import (
    A2C_VILLAIN_PORTFOLIO_DEFINITIONS,
    PORTFOLIO_AGGREGATE_DEFINITIONS,
    PORTFOLIO_DEFINITIONS,
    PortfolioCategory,
    aggregate_bucket_distribution,
    build_prior_a2c_villain_portfolio,
    build_nlhe_portfolio,
    build_prior_nlhe_portfolio,
    completion_street_for_definition,
)
from essence_of_poker.ranks import Rank


class PortfolioTests(unittest.TestCase):
    def setUp(self) -> None:
        self.hole_cards = (
            Card(Rank.ACE, Suit.SPADES),
            Card(Rank.KING, Suit.HEARTS),
        )
        self.community_cards = (
            Card(Rank.QUEEN, Suit.DIAMONDS),
            Card(Rank.JACK, Suit.CLUBS),
            Card(Rank.TEN, Suit.SPADES),
            Card(Rank.NINE, Suit.HEARTS),
            Card(Rank.EIGHT, Suit.DIAMONDS),
        )

    def test_portfolio_has_21_asset_definitions_in_four_categories(self) -> None:
        self.assertEqual(len(PORTFOLIO_DEFINITIONS), 21)

        category_counts = {
            category: len(
                tuple(
                    definition
                    for definition in PORTFOLIO_DEFINITIONS
                    if definition.category == category
                )
            )
            for category in PortfolioCategory
        }

        self.assertEqual(category_counts[PortfolioCategory.ZERO], 1)
        self.assertEqual(category_counts[PortfolioCategory.CARD_1], 5)
        self.assertEqual(category_counts[PortfolioCategory.CARD_2], 5)
        self.assertEqual(category_counts[PortfolioCategory.CARD_1_PLUS_CARD_2], 10)

    def test_build_nlhe_portfolio_creates_21_assets(self) -> None:
        portfolio = build_nlhe_portfolio(self.hole_cards, self.community_cards)

        self.assertEqual(len(portfolio.assets), 21)
        self.assertEqual(len(portfolio.zero_category), 1)
        self.assertEqual(len(portfolio.card_1_category), 5)
        self.assertEqual(len(portfolio.card_2_category), 5)
        self.assertEqual(len(portfolio.card_1_plus_card_2_category), 10)

    def test_asset_definitions_are_sorted_by_completion_street_within_category(self) -> None:
        expected_codes_by_category = {
            PortfolioCategory.ZERO: ("1.1",),
            PortfolioCategory.CARD_1: ("2.1", "2.2", "2.3", "2.4", "2.5"),
            PortfolioCategory.CARD_2: ("3.1", "3.2", "3.3", "3.4", "3.5"),
            PortfolioCategory.CARD_1_PLUS_CARD_2: (
                "4.1",
                "4.2",
                "4.4",
                "4.7",
                "4.3",
                "4.5",
                "4.6",
                "4.8",
                "4.9",
                "4.10",
            ),
        }
        expected_streets_by_category = {
            PortfolioCategory.ZERO: ("R",),
            PortfolioCategory.CARD_1: ("T", "R", "R", "R", "R"),
            PortfolioCategory.CARD_2: ("T", "R", "R", "R", "R"),
            PortfolioCategory.CARD_1_PLUS_CARD_2: ("F", "T", "T", "T", "R", "R", "R", "R", "R", "R"),
        }

        for category, expected_codes in expected_codes_by_category.items():
            definitions = tuple(
                definition for definition in PORTFOLIO_DEFINITIONS if definition.category == category
            )
            self.assertEqual(tuple(definition.code for definition in definitions), expected_codes)
            self.assertEqual(
                tuple(completion_street_for_definition(definition) for definition in definitions),
                expected_streets_by_category[category],
            )

    def test_build_prior_nlhe_portfolio_creates_21_empty_assets(self) -> None:
        portfolio = build_prior_nlhe_portfolio()

        self.assertEqual(len(portfolio.assets), 21)
        for portfolio_asset in portfolio.assets:
            self.assertEqual(portfolio_asset.asset.empty_slot_count, 5)
            self.assertEqual(portfolio_asset.asset.partial_deck, FULL_DECK)

    def test_a2c_villain_portfolio_uses_villain_hole_labels(self) -> None:
        self.assertEqual(len(A2C_VILLAIN_PORTFOLIO_DEFINITIONS), 21)
        self.assertEqual(
            A2C_VILLAIN_PORTFOLIO_DEFINITIONS[11].name,
            "V_1 + V_2 + F_1 + F_2 + F_3",
        )
        self.assertEqual(
            A2C_VILLAIN_PORTFOLIO_DEFINITIONS[11].positions,
            ("villain_1", "villain_2", "flop_1", "flop_2", "flop_3"),
        )

    def test_build_prior_a2c_villain_portfolio_creates_21_empty_assets(self) -> None:
        portfolio = build_prior_a2c_villain_portfolio()

        self.assertEqual(len(portfolio.assets), 21)
        for portfolio_asset in portfolio.assets:
            self.assertEqual(portfolio_asset.asset.empty_slot_count, 5)
            self.assertEqual(portfolio_asset.asset.partial_deck, FULL_DECK)

    def test_portfolio_aggregate_definitions_cover_expected_asset_groups(self) -> None:
        by_code = {aggregate.code: aggregate for aggregate in PORTFOLIO_AGGREGATE_DEFINITIONS}

        self.assertEqual(tuple(by_code), ("AGG", "AGG_BOTH", "AGG_H1", "AGG_H2", "AGG_ZERO"))
        self.assertEqual(len(by_code["AGG"].asset_codes), 21)
        self.assertEqual(len(by_code["AGG_BOTH"].asset_codes), 10)
        self.assertEqual(len(by_code["AGG_H1"].asset_codes), 5)
        self.assertEqual(len(by_code["AGG_H2"].asset_codes), 5)
        self.assertEqual(by_code["AGG_ZERO"].asset_codes, ("1.1",))
        self.assertIsNone(by_code["AGG"].category)
        self.assertEqual(by_code["AGG_BOTH"].category, PortfolioCategory.CARD_1_PLUS_CARD_2)
        self.assertEqual(by_code["AGG_H1"].category, PortfolioCategory.CARD_1)
        self.assertEqual(by_code["AGG_H2"].category, PortfolioCategory.CARD_2)
        self.assertEqual(by_code["AGG_ZERO"].category, PortfolioCategory.ZERO)

    def test_zero_category_is_the_board(self) -> None:
        portfolio = build_nlhe_portfolio(self.hole_cards, self.community_cards)

        self.assertEqual(portfolio.zero_category[0].definition.code, "1.1")
        self.assertEqual(portfolio.zero_category[0].asset.slots, self.community_cards)

    def test_card_1_category_matches_named_assets(self) -> None:
        portfolio = build_nlhe_portfolio(self.hole_cards, self.community_cards)
        by_code = {asset.definition.code: asset for asset in portfolio.assets}

        self.assertEqual(
            by_code["2.1"].asset.slots,
            (
                self.hole_cards[0],
                self.community_cards[0],
                self.community_cards[1],
                self.community_cards[2],
                self.community_cards[3],
            ),
        )
        self.assertEqual(
            by_code["2.5"].asset.slots,
            (
                self.hole_cards[0],
                self.community_cards[1],
                self.community_cards[2],
                self.community_cards[3],
                self.community_cards[4],
            ),
        )

    def test_card_1_plus_card_2_category_ends_with_flop_3_turn_river(self) -> None:
        portfolio = build_nlhe_portfolio(self.hole_cards, self.community_cards)
        by_code = {asset.definition.code: asset for asset in portfolio.assets}

        self.assertEqual(by_code["4.10"].definition.name, "H_1 + H_2 + F_3 + T + R")
        self.assertEqual(
            by_code["4.10"].asset.slots,
            (
                self.hole_cards[0],
                self.hole_cards[1],
                self.community_cards[2],
                self.community_cards[3],
                self.community_cards[4],
            ),
        )

    def test_portfolio_partial_deck_removes_all_known_cards(self) -> None:
        portfolio = build_nlhe_portfolio(self.hole_cards, self.community_cards)
        known_cards = set(self.hole_cards + self.community_cards)

        for portfolio_asset in portfolio.assets:
            self.assertEqual(len(portfolio_asset.asset.partial_deck), len(FULL_DECK) - 7)
            self.assertFalse(known_cards.intersection(portfolio_asset.asset.partial_deck))

    def test_portfolio_rejects_duplicate_known_cards(self) -> None:
        with self.assertRaises(ValueError):
            build_nlhe_portfolio(
                self.hole_cards,
                (
                    self.hole_cards[0],
                    self.community_cards[1],
                    self.community_cards[2],
                    self.community_cards[3],
                    self.community_cards[4],
                ),
            )

    def test_aggregate_distribution_matches_minimum_completed_asset(self) -> None:
        known_cards_by_position = {
            "hole_1": self.hole_cards[0],
            "hole_2": self.hole_cards[1],
            "flop_1": self.community_cards[0],
            "flop_2": self.community_cards[1],
            "flop_3": self.community_cards[2],
            "turn": self.community_cards[3],
            "river": self.community_cards[4],
        }
        distribution = aggregate_bucket_distribution(
            known_cards_by_position=known_cards_by_position,
            partial_deck=tuple(card for card in FULL_DECK if card not in set(known_cards_by_position.values())),
        )
        nonzero = tuple((bucket, count) for bucket, count in distribution.items() if count)
        portfolio = build_nlhe_portfolio(self.hole_cards, self.community_cards)
        best_asset_gradation = min(
            bucket.gradation
            for portfolio_asset in portfolio.assets
            for bucket, count in portfolio_asset.asset.bucket_distribution().items()
            if count
        )

        self.assertEqual(len(nonzero), 1)
        self.assertEqual(nonzero[0][0].gradation, best_asset_gradation)
        self.assertEqual(nonzero[0][1], 1)


if __name__ == "__main__":
    unittest.main()
