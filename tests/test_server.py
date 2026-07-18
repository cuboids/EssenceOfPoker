import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from essence_of_poker.cache import MemoryCache
from essence_of_poker.server import dashboard_root_from_environment, health_payload, static_cache_control


class ServerTests(unittest.TestCase):
    def test_dashboard_root_can_be_configured_by_environment(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict("os.environ", {"ESSENCE_DASHBOARD_ROOT": temp_dir}):
                self.assertEqual(dashboard_root_from_environment(), Path(temp_dir).resolve())

    def test_health_payload_reports_cache_and_build_status(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            dashboard_root = Path(temp_dir)
            (dashboard_root / "build_info.json").write_text(
                json.dumps({"version": "abc123", "builtAt": "2026-07-18T00:00:00+00:00"}),
                encoding="utf-8",
            )
            cache = MemoryCache(redis_url_configured=True, fallback_reason="ConnectionError")

            payload = health_payload(cache, dashboard_root)

            self.assertTrue(payload["ok"])
            self.assertEqual(payload["cache"]["backend"], "memory")
            self.assertTrue(payload["cache"]["redisUrlConfigured"])
            self.assertFalse(payload["cache"]["redisAvailable"])
            self.assertEqual(payload["cache"]["fallbackReason"], "ConnectionError")
            self.assertEqual(payload["build"]["version"], "abc123")
            self.assertEqual(payload["dashboardRoot"], str(dashboard_root))

    def test_static_cache_policy_distinguishes_versioned_assets(self) -> None:
        self.assertEqual(static_cache_control("/app.js?v=abc123"), "public, max-age=31536000, immutable")
        self.assertEqual(static_cache_control("/"), "no-cache")
        self.assertEqual(static_cache_control("/index.html"), "no-cache")


if __name__ == "__main__":
    unittest.main()
