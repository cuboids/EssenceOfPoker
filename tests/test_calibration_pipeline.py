from __future__ import annotations

import json
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from zipfile import ZipFile

from essence_of_poker.calibration.baseline_tables import build_empirical_baseline_tables, lookup_probabilities
from essence_of_poker.calibration.compact_importer import import_compact_zip
from essence_of_poker.calibration.compact_model import train_compact_softmax_model
from essence_of_poker.calibration.empirical_runtime import (
    build_empirical_spot_cache,
    empirical_spot_cache_status,
    load_empirical_spot_cache,
    empirical_spot_payload,
    empirical_spot_payload_cached,
)
from essence_of_poker.calibration.features import aggregate_player_stats, extract_training_examples
from essence_of_poker.calibration.interesting_hands import build_interesting_hand_subset, interesting_label, select_interesting_hands
from essence_of_poker.calibration.model import archetype_probabilities, train_calibrated_model
from essence_of_poker.calibration.model import deterministic_fold
from essence_of_poker.calibration.phh_importer import iter_hand_histories
from essence_of_poker.calibration.pipeline import import_hands, train_from_store
from essence_of_poker.calibration.repository import CalibrationStore


SAMPLE_HANDS = [
    {
        "source": "phh",
        "hand_id": "h1",
        "site": "PokerStars",
        "played_at": "2009-07-03T12:00:00Z",
        "bigBlind": 1.0,
        "maxPlayers": 6,
        "players": [
            {"id": "lj", "seat": 1, "position": "LJ", "stack_bb": 100, "cards": ["As", "Ah"]},
            {"id": "hj", "seat": 2, "position": "HJ", "stack_bb": 100, "cards": ["7c", "2d"]},
            {"id": "bb", "seat": 6, "position": "BB", "stack_bb": 100, "cards": ["Ks", "Qd"]},
        ],
        "board": ["2s", "7s", "9d", "Tc", "Jc"],
        "actions": [
            {"player": "lj", "street": "preflop", "type": "raise", "amount_bb": 3.0},
            {"player": "hj", "street": "preflop", "type": "fold"},
            {"player": "bb", "street": "preflop", "type": "call", "amount_bb": 2.0},
            {"player": "lj", "street": "flop", "type": "bet", "amount_bb": 4.0},
            {"player": "bb", "street": "flop", "type": "call", "amount_bb": 4.0},
        ],
    },
    {
        "source": "phh",
        "hand_id": "h2",
        "site": "Full Tilt Poker",
        "played_at": "2023-01-03T12:00:00Z",
        "bigBlind": 10.0,
        "maxPlayers": 6,
        "players": [
            {"id": "co", "seat": 3, "position": "CO", "stack_bb": 100, "cards": ["Ac", "Kc"]},
            {"id": "btn", "seat": 4, "position": "BTN", "stack_bb": 100, "cards": ["8h", "8d"]},
            {"id": "bb", "seat": 6, "position": "BB", "stack_bb": 100, "cards": ["Qs", "Jh"]},
        ],
        "actions": [
            {"player": "co", "street": "preflop", "type": "raise", "amount_bb": 2.5},
            {"player": "btn", "street": "preflop", "type": "call", "amount_bb": 2.5},
            {"player": "bb", "street": "preflop", "type": "fold"},
            {"player": "co", "street": "flop", "type": "check"},
            {"player": "btn", "street": "flop", "type": "bet", "amount_bb": 3.5},
            {"player": "co", "street": "flop", "type": "fold"},
        ],
    },
]


class CalibrationPipelineTest(unittest.TestCase):
    def test_importer_reads_jsonl_and_preserves_skill_signals(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "hands.jsonl"
            path.write_text("\n".join(json.dumps(hand) for hand in SAMPLE_HANDS))

            hands = list(iter_hand_histories(path))

        self.assertEqual(len(hands), 2)
        self.assertEqual(hands[0].stake_bb, 1.0)
        self.assertEqual(hands[1].played_at.year, 2023)
        self.assertEqual(hands[0].players[0].hole_cards[0].token, "As")

    def test_repository_round_trips_hands_and_training_rows(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / "calibration.sqlite3"
            with CalibrationStore(db) as store:
                store.initialize()
                hand = list(iter_fixture_hands())[0]
                hand_key = store.upsert_hand(hand)
                examples = extract_training_examples(hand_key, hand)
                store.insert_training_examples(examples)

                round_tripped = store.hands_for_feature_extraction()
                stored_examples = store.training_examples()

        self.assertEqual(round_tripped[0][0], "phh:h1")
        self.assertEqual(len(stored_examples), 5)
        self.assertEqual(stored_examples[0].features["position"], "LJ")

    def test_feature_extraction_uses_stakes_time_and_hole_cards(self) -> None:
        hand = list(iter_fixture_hands())[1]
        examples = extract_training_examples("phh:h2", hand)

        self.assertGreater(examples[0].features["skill_proxy"], 0)
        self.assertEqual(examples[0].features["hand_class"], "1-2-suited")
        self.assertEqual(examples[3].street, "flop")

    def test_model_cross_validation_and_archetypes_are_probabilistic(self) -> None:
        examples = []
        for hand in iter_fixture_hands():
            examples.extend(extract_training_examples(f"phh:{hand.source_hand_id}", hand))

        result = train_calibrated_model(examples, folds=2, dimensions=64)
        stats = aggregate_player_stats(examples)
        probabilities = archetype_probabilities(stats["lj"])

        self.assertEqual(result.payload["model"], "hashed_softmax_range_action")
        self.assertAlmostEqual(sum(probabilities.values()), 1.0)
        self.assertIn("cv_log_loss", result.metrics)

    def test_full_pipeline_imports_and_saves_model_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "hands.jsonl"
            db = Path(directory) / "calibration.sqlite3"
            path.write_text("\n".join(json.dumps(hand) for hand in SAMPLE_HANDS))

            import_result = import_hands(path, db)
            train_result = train_from_store(db, folds=2)

        self.assertEqual(import_result["hands"], 2)
        self.assertEqual(import_result["training_examples"], 11)
        self.assertEqual(train_result["metrics"]["examples"], 11)
        self.assertGreaterEqual(train_result["metrics"]["players_with_archetypes"], 3)

    def test_compact_import_stores_manifest_and_feature_counts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            zip_path = Path(directory) / "hands.zip"
            db = Path(directory) / "compact.sqlite3"
            phh_payload = """
[1]
variant = 'NT'
blinds_or_straddles = [0.5, 1.0, 0]
min_bet = 1.0
starting_stacks = [100, 100, 100]
players = ['a', 'b', 'c']
actions = ['d dh p1 AsAh', 'd dh p2 ????', 'd dh p3 KcQd', 'p3 cbr 3', 'p1 f', 'p2 cc']
venue = 'Test Room'
year = 2009
month = 7
day = 1
hand = 123
"""
            with ZipFile(zip_path, "w") as archive:
                archive.writestr("data/handhq/TEST-2009_100NLH_OBFU/1/test.phhs", phh_payload)

            result = import_compact_zip(zip_path, db, flush_every_files=1)

            import sqlite3

            self.assertEqual(result["hands"], 1)
            with closing(sqlite3.connect(db)) as con:
                self.assertEqual(con.execute("select count(*) from corpus_sources").fetchone()[0], 1)
                self.assertEqual(con.execute("select sum(hand_count) from corpus_files").fetchone()[0], 1)
                self.assertEqual(
                    con.execute("select sum(count) from action_feature_counts").fetchone()[0],
                    result["actions"],
                )

    def test_empirical_baseline_tables_are_normalized_and_cross_validated(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            zip_path = Path(directory) / "hands.zip"
            db = Path(directory) / "compact.sqlite3"
            output = Path(directory) / "baseline.json"
            with ZipFile(zip_path, "w") as archive:
                archive.writestr("data/handhq/TEST-2009_100NLH_OBFU/1/test.phhs", baseline_phh_payload())

            import_compact_zip(zip_path, db, flush_every_files=1)
            heldout = frozenset({deterministic_fold("phh:data/handhq/TEST-2009_100NLH_OBFU/1/test.phhs:123", 5)})
            result = build_empirical_baseline_tables(db, output_path=output, heldout_folds=heldout, min_exact_count=1)

            self.assertTrue(output.exists())
            self.assertGreater(result.metrics["heldout_actions"], 0)
            exact_entry = next(iter(result.artifact["tables"]["exact"].values()))
            self.assertAlmostEqual(sum(exact_entry["probabilities"].values()), 1.0)

    def test_empirical_baseline_sparse_exact_bucket_falls_back(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            zip_path = Path(directory) / "hands.zip"
            db = Path(directory) / "compact.sqlite3"
            with ZipFile(zip_path, "w") as archive:
                archive.writestr("data/handhq/TEST-2009_100NLH_OBFU/1/test.phhs", baseline_phh_payload())

            import_compact_zip(zip_path, db, flush_every_files=1)
            result = build_empirical_baseline_tables(db, min_exact_count=10_000)

            row = {
                "street": "preflop",
                "position": "BTN",
                "player_count": 3,
                "stake_bucket": "micro",
                "year_bucket": "2009-2010",
                "facing_aggression": 0,
                "amount_bucket": "large",
                "hand_class": "1-1-pair",
            }
            probabilities, level = lookup_probabilities(result.artifact, row)
            self.assertNotEqual(level, "exact")
            self.assertAlmostEqual(sum(probabilities.values()), 1.0)

    def test_empirical_runtime_returns_all_hand_classes_for_a_spot(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            zip_path = Path(directory) / "hands.zip"
            db = Path(directory) / "compact.sqlite3"
            with ZipFile(zip_path, "w") as archive:
                archive.writestr("data/handhq/TEST-2009_100NLH_OBFU/1/test.phhs", baseline_phh_payload())

            import_compact_zip(zip_path, db, flush_every_files=1)
            payload = empirical_spot_payload(
                db_path=db,
                street="preflop",
                position="BTN",
                player_count=3,
                stake_bucket="micro",
                year_bucket="2009-2010",
                facing_aggression=False,
                amount_bucket="large",
                min_exact_count=1,
            )

            self.assertTrue(payload["ok"])
            self.assertEqual(len(payload["handClasses"]), 169)
            self.assertIn("1-1-pair", payload["handClasses"])
            self.assertAlmostEqual(sum(payload["spotProbabilities"].values()), 1.0)

    def test_empirical_spot_cache_precomputes_and_serves_runtime_payloads(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            zip_path = Path(directory) / "hands.zip"
            db = Path(directory) / "compact.sqlite3"
            output = Path(directory) / "empirical_spots.json"
            with ZipFile(zip_path, "w") as archive:
                archive.writestr("data/handhq/TEST-2009_100NLH_OBFU/1/test.phhs", baseline_phh_payload())

            import_compact_zip(zip_path, db, flush_every_files=1)
            artifact = build_empirical_spot_cache(db, output_path=output, min_exact_count=1)
            status = empirical_spot_cache_status(output)
            payload = empirical_spot_payload_cached(
                cache_path=output,
                db_path=Path(directory) / "missing.sqlite3",
                street="preflop",
                position="BTN",
                player_count=3,
                stake_bucket="micro",
                year_bucket="2009-2010",
                facing_aggression=False,
                amount_bucket="overbet",
                min_exact_count=1,
            )

            self.assertTrue(output.exists())
            self.assertGreater(artifact["spotCount"], 0)
            self.assertEqual(artifact["contractVersion"], "empirical-spot-cache-v1")
            self.assertEqual(artifact["modelVersion"], "range-engine-v1")
            self.assertIn("sha256", artifact["sourceDb"])
            self.assertTrue(status["ok"])
            self.assertTrue(status["compatibility"]["ok"])
            self.assertEqual(status["sourceDb"]["sha256"], artifact["sourceDb"]["sha256"])
            self.assertTrue(payload["ok"])
            self.assertTrue(payload["cache"]["hit"])
            self.assertEqual(payload["cache"]["contractVersion"], "empirical-spot-cache-v1")
            self.assertEqual(len(payload["handClasses"]), 169)

    def test_empirical_spot_cache_reloads_when_file_changes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "empirical_spots.json"
            first = {
                "kind": "empirical_spot_cache",
                "version": 1,
                "contractVersion": "empirical-spot-cache-v1",
                "modelVersion": "range-engine-v1",
                "sourceDb": {"sha256": "a"},
                "spots": {"first": {"ok": True}},
            }
            second = {
                **first,
                "sourceDb": {"sha256": "b"},
                "spots": {"second": {"ok": True}},
            }
            output.write_text(json.dumps(first), encoding="utf-8")
            self.assertIn("first", load_empirical_spot_cache(str(output))["spots"])
            output.write_text(json.dumps(second), encoding="utf-8")
            self.assertIn("second", load_empirical_spot_cache(str(output))["spots"])

    def test_empirical_spot_cache_status_rejects_incompatible_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "empirical_spots.json"
            output.write_text(
                json.dumps({
                    "ok": True,
                    "kind": "empirical_spot_cache",
                    "version": 1,
                    "contractVersion": "old-version",
                    "modelVersion": "old-model",
                    "generatedAt": "2026-01-01T00:00:00+00:00",
                    "spots": {},
                    "sourceDb": {"sha256": "abc", "bytes": 1},
                }),
                encoding="utf-8",
            )

            status = empirical_spot_cache_status(output)

            self.assertFalse(status["ok"])
            self.assertIn("contract version mismatch", " ".join(status["compatibility"]["errors"]))

    def test_compact_softmax_model_trains_from_feature_counts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            zip_path = Path(directory) / "hands.zip"
            db = Path(directory) / "compact.sqlite3"
            output = Path(directory) / "compact_model.json"
            with ZipFile(zip_path, "w") as archive:
                archive.writestr("data/handhq/TEST-2009_100NLH_OBFU/1/test.phhs", baseline_phh_payload())

            import_compact_zip(zip_path, db, flush_every_files=1)
            artifact = train_compact_softmax_model(db, output_path=output, dimensions=32, epochs=2, folds=2)

            self.assertTrue(output.exists())
            self.assertEqual(artifact["kind"], "compact_softmax_action_model")
            self.assertIn("payload", artifact)
            self.assertIn("folds", artifact["crossValidation"])

    def test_interesting_hand_subset_labels_and_persists_action_rich_hands(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            zip_path = Path(directory) / "hands.zip"
            output_db = Path(directory) / "interesting.sqlite3"
            output_jsonl = Path(directory) / "interesting.jsonl"
            with ZipFile(zip_path, "w") as archive:
                archive.writestr("data/handhq/TEST-2009_100NLH_OBFU/1/test.phhs", interesting_phh_payload())

            selected = select_interesting_hands(zip_path, limit=2, min_score=10)
            result = build_interesting_hand_subset(
                zip_path,
                output_db=output_db,
                output_jsonl=output_jsonl,
                limit=2,
                min_score=10,
            )

            import sqlite3

            self.assertEqual(result["selected_hands"], 2)
            self.assertTrue(output_jsonl.exists())
            self.assertGreaterEqual(selected[0]["score"], selected[1]["score"])
            self.assertIn("multi-street action", selected[0]["reasons"])
            with closing(sqlite3.connect(output_db)) as con:
                self.assertEqual(con.execute("select count(*) from interesting_hands").fetchone()[0], 2)
                row = con.execute("select reasons_json from interesting_hands order by score desc limit 1").fetchone()
            self.assertIn("multi-street action", row[0])

    def test_interesting_label_scores_all_in_and_river_hands(self) -> None:
        hand = list(iter_fixture_hands())[0]
        label = interesting_label(hand)

        self.assertIn("multi-street action", label["reasons"])
        self.assertGreater(label["score"], 12)


def iter_fixture_hands():
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "hands.jsonl"
        path.write_text("\n".join(json.dumps(hand) for hand in SAMPLE_HANDS))
        yield from iter_hand_histories(path)


def baseline_phh_payload() -> str:
    return """
[1]
variant = 'NT'
blinds_or_straddles = [0.5, 1.0, 0]
min_bet = 1.0
starting_stacks = [100, 100, 100]
players = ['a', 'b', 'c']
actions = ['d dh p1 AsAh', 'd dh p2 KcQd', 'd dh p3 7h2c', 'p3 cbr 3', 'p1 f', 'p2 cc']
venue = 'Test Room'
year = 2009
month = 7
day = 1
hand = 123

[2]
variant = 'NT'
blinds_or_straddles = [0.5, 1.0, 0]
min_bet = 1.0
starting_stacks = [100, 100, 100]
players = ['a', 'b', 'c']
actions = ['d dh p1 AcAd', 'd dh p2 KsQs', 'd dh p3 8h8c', 'p3 cbr 3', 'p1 cc', 'p2 f']
venue = 'Test Room'
year = 2009
month = 7
day = 1
hand = 124

[3]
variant = 'NT'
blinds_or_straddles = [0.5, 1.0, 0]
min_bet = 1.0
starting_stacks = [100, 100, 100]
players = ['a', 'b', 'c']
actions = ['d dh p1 2s2d', 'd dh p2 AhKh', 'd dh p3 QhJh', 'p3 f', 'p1 cc', 'p2 cbr 4']
venue = 'Test Room'
year = 2009
month = 7
day = 1
hand = 125
"""


def interesting_phh_payload() -> str:
    return """
[1]
variant = 'NT'
blinds_or_straddles = [0.5, 1.0, 0, 0, 0, 0]
min_bet = 1.0
starting_stacks = [100, 100, 100, 100, 100, 100]
players = ['a', 'b', 'c', 'd', 'e', 'f']
actions = ['d dh p1 AsAh', 'd dh p2 KsQs', 'd dh p3 8h8c', 'd dh p4 7s6s', 'd dh p5 QdJd', 'd dh p6 2c2d', 'p3 cbr 3', 'p4 cc', 'p5 cc', 'p6 cc', 'p1 cbr 14', 'p2 f', 'p3 cc', 'p4 f', 'p5 cc', 'p6 f', 'd db 2s7s9d', 'p1 cbr 24', 'p3 cc', 'p5 cbr 60', 'p1 cc', 'p3 f', 'd db Tc', 'p1 cc', 'p5 cbr 100', 'd db Jc']
venue = 'Test Room'
year = 2009
month = 7
day = 1
hand = 900

[2]
variant = 'NT'
blinds_or_straddles = [0.5, 1.0, 0]
min_bet = 1.0
starting_stacks = [100, 100, 100]
players = ['a', 'b', 'c']
actions = ['d dh p1 AcAd', 'd dh p2 KsQs', 'd dh p3 8h8c', 'p3 cbr 3', 'p1 cc', 'p2 f', 'd db 2s7s9d', 'p1 cc', 'p3 cbr 6', 'p1 cc']
venue = 'Test Room'
year = 2009
month = 7
day = 1
hand = 901

[3]
variant = 'NT'
blinds_or_straddles = [0.5, 1.0, 0]
min_bet = 1.0
starting_stacks = [100, 100, 100]
players = ['a', 'b', 'c']
actions = ['d dh p1 2s2d', 'd dh p2 AhKh', 'd dh p3 QhJh', 'p3 f', 'p1 cc', 'p2 cc']
venue = 'Test Room'
year = 2009
month = 7
day = 1
hand = 902
"""


if __name__ == "__main__":
    unittest.main()
