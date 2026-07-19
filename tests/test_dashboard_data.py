import unittest
import json
from pathlib import Path

from essence_of_poker.dashboard_data import prior_dashboard_data


class DashboardDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.data = prior_dashboard_data()

    def test_prior_dashboard_data_has_21_assets(self) -> None:
        data = self.data

        self.assertEqual(len(data["assets"]), 21)
        self.assertEqual(data["bucketCount"], 7462)
        self.assertEqual(data["totalCombos"], 2598960)
        self.assertEqual(data["priorAggregate"]["totalCombos"], 133784560)
        self.assertEqual(data["priorAggregate"]["bestGradation"], 1)
        self.assertEqual(data["priorAggregate"]["worstGradation"], 7414)
        self.assertEqual(len(data["priorAggregate"]["counts"]), 7463)
        self.assertEqual(sum(data["priorAggregate"]["counts"]), 133784560)
        seven_card_category_counts = {
            band["name"]: sum(data["priorAggregate"]["counts"][band["start"] : band["end"] + 1])
            for band in data["categoryBands"]
        }
        self.assertEqual(seven_card_category_counts["Straight flush"], 41584)
        self.assertEqual(seven_card_category_counts["Four of a kind"], 224848)
        self.assertEqual(seven_card_category_counts["Full house"], 3473184)
        self.assertEqual(seven_card_category_counts["Flush"], 4047644)
        self.assertEqual(seven_card_category_counts["Straight"], 6180020)
        self.assertEqual(seven_card_category_counts["Three of a kind"], 6461620)
        self.assertEqual(seven_card_category_counts["Two pair"], 31433400)
        self.assertEqual(seven_card_category_counts["One pair"], 58627800)
        self.assertEqual(seven_card_category_counts["High card"], 23294460)
        self.assertEqual(len(data["curve"]), 7462)
        self.assertEqual(len(data["bucketKeys"]), 7462)
        self.assertEqual(data["curve"][0]["gradation"], 1)
        self.assertEqual(data["curve"][-1]["gradation"], 7462)
        self.assertEqual(data["curve"][-1]["probability"], 1)
        self.assertEqual(data["curve"][-1]["x"], 1)
        self.assertEqual(data["assets"][0]["code"], "1.1")
        self.assertEqual(data["assets"][0]["name"], "F_1 + F_2 + F_3 + T + R")
        self.assertEqual(data["assets"][-1]["code"], "4.10")
        self.assertEqual(data["assets"][-1]["name"], "H_1 + H_2 + F_3 + T + R")
        self.assertTrue(all(asset["active"] for asset in data["assets"]))
        self.assertEqual(len(data["categoryBands"]), 9)
        self.assertTrue(all("color" in band for band in data["categoryBands"]))
        self.assertTrue(all("startX" in band and "endX" in band for band in data["categoryBands"]))
        self.assertGreater(len(data["subcategoryBands"]), 9)
        self.assertTrue(all("shade" in band for band in data["subcategoryBands"]))
        self.assertTrue(all("color" in band for band in data["subcategoryBands"]))
        self.assertTrue(all("startX" in band and "endX" in band for band in data["subcategoryBands"]))

    def test_prior_payloads_are_attached_to_assets_and_aggregates(self) -> None:
        data = self.data

        for portfolio in data["portfolios"].values():
            for asset in portfolio["assets"]:
                self.assertEqual(sum(asset["prior"]["counts"]), asset["prior"]["totalCombos"])
                self.assertEqual(asset["prior"]["bestGradation"], asset["prior"]["first"])
            for aggregate in portfolio["aggregates"]:
                self.assertEqual(sum(aggregate["prior"]["counts"]), aggregate["prior"]["totalCombos"])
                self.assertEqual(aggregate["prior"]["bestGradation"], aggregate["prior"]["first"])

    def test_h1h2_flop_prior_matches_generic_five_card_distribution(self) -> None:
        data = self.data
        h1h2_flop = next(
            asset for asset in data["portfolios"]["hero"]["assets"] if asset["code"] == "4.1"
        )
        counts = _expanded_prior(h1h2_flop["prior"], data["bucketCount"])
        generic_counts = _generic_five_card_counts(data)
        scale = sum(counts) // sum(generic_counts)

        self.assertEqual(sum(counts), sum(generic_counts) * scale)
        self.assertEqual(counts, [count * scale for count in generic_counts])

    def test_order_sensitive_primary_assets_have_exact_non_generic_priors(self) -> None:
        data = self.data
        distinct_priors = {
            json.dumps(asset["prior"], sort_keys=True)
            for asset in data["portfolios"]["hero"]["assets"]
        }
        h1_f1_f2_turn_river = next(
            asset for asset in data["portfolios"]["hero"]["assets"] if asset["code"] == "2.3"
        )

        self.assertGreater(len(distinct_priors), 1)
        self.assertEqual(h1_f1_f2_turn_river["prior"]["totalCombos"], 56189515200)
        self.assertNotEqual(
            _probabilities(_expanded_prior(h1_f1_f2_turn_river["prior"], data["bucketCount"])),
            _probabilities(_generic_five_card_counts(data)),
        )

    def test_hand_aggregate_prior_matches_generic_seven_card_distribution(self) -> None:
        data = self.data
        hand_aggregate = next(
            aggregate for aggregate in data["portfolios"]["hero"]["aggregates"] if aggregate["code"] == "AGG"
        )
        aggregate_counts = _expanded_prior(hand_aggregate["prior"], data["bucketCount"])
        scale = aggregate_counts[1] // data["priorAggregate"]["counts"][1]

        self.assertEqual(scale, 21)
        self.assertEqual(aggregate_counts, [count * scale for count in data["priorAggregate"]["counts"]])

    def test_both_hole_cards_aggregate_has_its_own_prior_distribution(self) -> None:
        data = self.data
        both_aggregate = next(
            aggregate for aggregate in data["portfolios"]["hero"]["aggregates"] if aggregate["code"] == "AGG_BOTH"
        )

        self.assertNotEqual(
            _probabilities(_expanded_prior(both_aggregate["prior"], data["bucketCount"])),
            _probabilities(data["priorAggregate"]["counts"]),
        )

    def test_prior_dashboard_data_includes_hero_and_villain_portfolios(self) -> None:
        data = self.data

        self.assertEqual(len(data["portfolios"]["hero"]["assets"]), 21)
        self.assertEqual(len(data["portfolios"]["hero"]["aggregates"]), 5)
        self.assertEqual(len(data["portfolios"]["villain"]["assets"]), 21)
        self.assertEqual(len(data["portfolios"]["villain"]["aggregates"]), 5)
        self.assertEqual(data["portfolios"]["hero"]["aggregates"][0]["name"], "Hand Aggregate")
        self.assertEqual(len(data["portfolios"]["hero"]["aggregates"][1]["assetCodes"]), 10)
        self.assertEqual(
            [aggregate["category"] for aggregate in data["portfolios"]["hero"]["aggregates"]],
            ["AGGREGATE", "CARD_1_PLUS_CARD_2", "CARD_1", "CARD_2", "ZERO"],
        )
        self.assertEqual(
            data["portfolios"]["villain"]["assets"][11]["name"],
            "V_1 + V_2 + F_1 + F_2 + F_3",
        )
        self.assertEqual(
            data["portfolios"]["villain"]["assets"][11]["positions"],
            ("villain_1", "villain_2", "flop_1", "flop_2", "flop_3"),
        )

    def test_preflop_aggregate_cache_has_all_canonical_starting_hands(self) -> None:
        cache_path = Path(__file__).resolve().parent.parent / "essence_of_poker" / "data" / "preflop_aggregate_cache.json"
        cache = json.loads(cache_path.read_text(encoding="utf-8"))

        self.assertEqual(cache["totalCombos"], 2118760)
        self.assertEqual(len(cache["classes"]), 169)
        for hand_class in cache["classes"].values():
            self.assertEqual(set(hand_class), {"AGG", "AGG_BOTH", "AGG_H1", "AGG_H2"})
            for aggregate in hand_class.values():
                self.assertEqual(sum(aggregate["counts"]), 2118760)

def _expanded_prior(prior: dict, bucket_count: int) -> list[int]:
    counts = [0] * (bucket_count + 1)
    for offset, count in enumerate(prior["counts"]):
        counts[prior["first"] + offset] = count
    return counts


def _generic_five_card_counts(data: dict) -> list[int]:
    counts = [0] * (data["bucketCount"] + 1)
    previous = 0
    for point in data["curve"]:
        total = data["totalCombos"]
        cumulative = round(point["probability"] * total)
        counts[point["gradation"]] = cumulative - previous
        previous = cumulative
    return counts


def _probabilities(counts: list[int]) -> list[float]:
    total = sum(counts)
    return [count / total for count in counts]


if __name__ == "__main__":
    unittest.main()
