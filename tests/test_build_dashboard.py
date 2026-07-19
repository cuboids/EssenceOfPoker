import json
import tempfile
import unittest
from pathlib import Path

from essence_of_poker.build_dashboard import build_dashboard


class BuildDashboardTests(unittest.TestCase):
    def test_build_dashboard_writes_versioned_artifact(self) -> None:
        source = Path(__file__).resolve().parent.parent / "dashboard"
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "dashboard"

            build_info = build_dashboard(source, output)

            self.assertTrue((output / "index.html").exists())
            self.assertTrue((output / "app.js").exists())
            self.assertTrue((output / "styles.css").exists())
            self.assertTrue((output / "data" / "prior_portfolio.json").exists())
            self.assertRegex(build_info["version"], r"^[0-9a-f]{16}$")

            manifest = json.loads((output / "asset-manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["version"], build_info["version"])
            self.assertRegex(manifest["assets"]["app.js"], r"^[0-9a-f]{12}$")
            self.assertRegex(manifest["assets"]["styles.css"], r"^[0-9a-f]{12}$")

            index_html = (output / "index.html").read_text(encoding="utf-8")
            app_js = (output / "app.js").read_text(encoding="utf-8")
            self.assertIn(f'window.ESSENCE_ASSET_VERSION = "{build_info["version"]}"', index_html)
            self.assertIn(f'app.js?v={manifest["assets"]["app.js"]}-{build_info["version"]}', index_html)
            self.assertIn(f'styles.css?v={manifest["assets"]["styles.css"]}-{build_info["version"]}', index_html)
            self.assertIn('from "./cards.mjs"', app_js)
            self.assertNotIn(f'?v={build_info["version"]}', app_js)
            self.assertNotIn("frontend-modules-2", index_html)


if __name__ == "__main__":
    unittest.main()
