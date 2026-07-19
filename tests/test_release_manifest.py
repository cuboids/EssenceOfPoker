import json
import tempfile
import unittest
from pathlib import Path

from essence_of_poker.release_manifest import build_release_manifest, write_release_manifest


class ReleaseManifestTests(unittest.TestCase):
    def test_release_manifest_ties_build_versions_to_cache_namespace(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            dashboard_root = Path(directory) / "dashboard"
            dashboard_root.mkdir()
            (dashboard_root / "build_info.json").write_text(
                json.dumps({"version": "abc123", "builtAt": "2026-07-19T00:00:00+00:00"}),
                encoding="utf-8",
            )
            (dashboard_root / "asset_manifest.json").write_text(
                json.dumps({"version": "abc123", "assets": {"app.js": "hash"}}),
                encoding="utf-8",
            )

            manifest = build_release_manifest(dashboard_root)

        self.assertTrue(manifest["ok"])
        self.assertEqual(manifest["dashboard"]["build"]["version"], "abc123")
        self.assertEqual(manifest["cache"]["namespace"], "cache-schema-v1:abc123")
        self.assertEqual(manifest["versions"]["generatedData"]["priorPortfolio"], "prior-portfolio-v1")
        self.assertTrue(manifest["generatedData"]["priorPortfolio"]["ok"])

    def test_write_release_manifest_outputs_json(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            dashboard_root = Path(directory) / "dashboard"
            output = Path(directory) / "release.json"
            dashboard_root.mkdir()
            (dashboard_root / "build_info.json").write_text(json.dumps({"version": "v1"}), encoding="utf-8")
            (dashboard_root / "asset_manifest.json").write_text(json.dumps({"assets": {}}), encoding="utf-8")

            write_release_manifest(output, dashboard_root)

            payload = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(payload["kind"], "essence_release_manifest")
        self.assertEqual(payload["cache"]["namespace"], "cache-schema-v1:v1")


if __name__ == "__main__":
    unittest.main()
