import unittest

from essence_of_poker.artifact_policy import matching_rule, tracked_policy_violations


class ArtifactPolicyTests(unittest.TestCase):
    def test_policy_classifies_local_only_and_tracked_generated_artifacts(self) -> None:
        self.assertEqual(matching_rule("data/calibration_compact.sqlite3").disposition, "local-only")
        self.assertEqual(matching_rule("dist/dashboard/app.js").disposition, "build-output")
        self.assertEqual(
            matching_rule("essence_of_poker/data/preflop_aggregate_classes/1-1-pair.json.gz").disposition,
            "tracked-generated",
        )
        self.assertEqual(
            matching_rule("essence_of_poker/data/preflop_aggregate_manifest.json").disposition,
            "tracked-generated",
        )
        self.assertEqual(
            matching_rule("essence_of_poker/data/preflop_aggregate_cache.json").disposition,
            "tracked-generated",
        )

    def test_policy_flags_tracked_local_or_monolithic_artifacts(self) -> None:
        violations = tracked_policy_violations([
            "README.md",
            "data/phh/poker-hand-histories.zip",
            "dist/dashboard/app.js",
            "essence_of_poker/data/preflop_aggregate_cache.json",
            "essence_of_poker/data/preflop_primary_prior_cache.json",
            "essence_of_poker/data/preflop_primary_classes/1-1-pair.json.gz",
        ])

        self.assertEqual(
            [violation["path"] for violation in violations],
            [
                "data/phh/poker-hand-histories.zip",
                "dist/dashboard/app.js",
                "essence_of_poker/data/preflop_primary_prior_cache.json",
            ],
        )


if __name__ == "__main__":
    unittest.main()
