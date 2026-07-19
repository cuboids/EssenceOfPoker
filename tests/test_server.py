import json
import tempfile
import unittest
from contextlib import closing
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from essence_of_poker.api_routes import (
    API_CACHE,
    API_HEALTH,
    API_NOT_FOUND,
    API_PREFLOP_CLASS_DATA,
    match_api_route,
    preflop_class_data_path,
)
from essence_of_poker.cache import MemoryCache
from essence_of_poker.server import (
    cache_write_is_authorized,
    cached_data_health_payload,
    class_data_status,
    dashboard_compatible_interesting_hand,
    dashboard_root_from_environment,
    empirical_calibration_status,
    health_payload,
    random_interesting_hand_payload,
    static_cache_control,
    valid_preflop_class_key,
)
from essence_of_poker.wsgi import EssencePokerWsgiApp


class ServerTests(unittest.TestCase):
    def test_dashboard_root_can_be_configured_by_environment(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict("os.environ", {"ESSENCE_DASHBOARD_ROOT": temp_dir}):
                self.assertEqual(dashboard_root_from_environment(), Path(temp_dir).resolve())

    def test_api_route_table_is_shared_by_http_and_wsgi_adapters(self) -> None:
        self.assertEqual(match_api_route("GET", "/api/health").name, API_HEALTH)
        self.assertEqual(match_api_route("PUT", "/api/cache/example").name, API_CACHE)
        self.assertEqual(match_api_route("GET", "/api/nope").name, API_NOT_FOUND)
        route = match_api_route("GET", "/api/data/preflop-primary/1-1-pair")

        self.assertEqual(route.name, API_PREFLOP_CLASS_DATA)
        self.assertEqual(route.class_key, "1-1-pair")
        self.assertEqual(route.data_family, "primary")
        self.assertEqual(
            preflop_class_data_path(Path("/repo"), route.data_family, route.class_key),
            Path("/repo/essence_of_poker/data/preflop_primary_classes/1-1-pair.json.gz"),
        )

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
            self.assertEqual(payload["security"]["cacheWrites"]["mode"], "loopback-only")
            self.assertEqual(payload["versions"]["cacheSchema"], "cache-schema-v1")
            self.assertEqual(payload["versions"]["cacheFamilies"]["winShareRunouts"], "winshare-runouts-v2")
            self.assertEqual(payload["versions"]["models"]["rangeEngine"], "range-engine-v1")
            self.assertEqual(payload["versions"]["generatedData"]["empiricalSpotCache"], "empirical-spot-cache-v1")
            self.assertEqual(payload["dashboardRoot"], str(dashboard_root))
            self.assertIn("preflopAggregateClasses", payload["data"])
            self.assertIn("preflopHiddenVillainClasses", payload["data"])
            self.assertIn("preflopPrimaryClasses", payload["data"])
            self.assertIn("empiricalCalibration", payload["data"])
            self.assertIn("empiricalSpotCache", payload["data"])

    def test_data_health_payload_is_cached_for_short_polling_windows(self) -> None:
        with patch("essence_of_poker.api_handlers._DATA_HEALTH_CACHE", None):
            with patch("essence_of_poker.api_handlers.data_health_payload", side_effect=[
                {"generation": 1},
                {"generation": 2},
            ]), patch("essence_of_poker.api_handlers.time.monotonic", side_effect=[100.0, 101.0, 107.0]):
                self.assertEqual(cached_data_health_payload()["generation"], 1)
                self.assertEqual(cached_data_health_payload()["generation"], 1)
                self.assertEqual(cached_data_health_payload()["generation"], 2)

    def test_cache_write_authorization_defaults_to_loopback_only(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            self.assertTrue(cache_write_is_authorized({}, ("127.0.0.1", 12345)))
            self.assertTrue(cache_write_is_authorized({}, ("127.12.0.1", 12345)))
            self.assertTrue(cache_write_is_authorized({}, ("::1", 12345)))
            self.assertFalse(cache_write_is_authorized({}, ("203.0.113.10", 12345)))

    def test_cache_write_authorization_can_require_token(self) -> None:
        with patch.dict("os.environ", {"ESSENCE_CACHE_WRITE_TOKEN": "secret"}):
            self.assertFalse(cache_write_is_authorized({}, ("127.0.0.1", 12345)))
            self.assertFalse(cache_write_is_authorized({"X-Essence-Cache-Token": "wrong"}, ("127.0.0.1", 12345)))
            self.assertTrue(cache_write_is_authorized({"X-Essence-Cache-Token": "secret"}, ("203.0.113.10", 12345)))

    def test_empirical_calibration_status_reports_missing_database(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            status = empirical_calibration_status(Path(temp_dir) / "missing.sqlite3")

        self.assertFalse(status["ok"])
        self.assertIn("path", status)

    def test_class_data_status_reports_manifest_and_class_count(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest = root / "manifest.json"
            classes = root / "classes"
            classes.mkdir()
            manifest.write_text("{}", encoding="utf-8")

            self.assertFalse(class_data_status(manifest, classes)["ok"])
            for index in range(169):
                (classes / f"{index}.json.gz").write_bytes(b"")
            manifest.write_text(json.dumps({"classes": [str(index) for index in range(169)]}), encoding="utf-8")

            status = class_data_status(manifest, classes)
            self.assertTrue(status["ok"])
            self.assertEqual(status["classCount"], 169)
            self.assertEqual(status["manifestClasses"], 169)

    def test_static_cache_policy_distinguishes_versioned_assets(self) -> None:
        self.assertEqual(static_cache_control("/app.js?v=abc123"), "public, max-age=31536000, immutable")
        self.assertEqual(static_cache_control("/"), "no-cache")
        self.assertEqual(static_cache_control("/index.html"), "no-cache")

    def test_preflop_class_key_validation_rejects_path_tricks(self) -> None:
        self.assertTrue(valid_preflop_class_key("1-1-pair"))
        self.assertTrue(valid_preflop_class_key("2-5-offsuit"))
        self.assertTrue(valid_preflop_class_key("2-5-suited"))
        self.assertFalse(valid_preflop_class_key("../1-1-pair"))
        self.assertFalse(valid_preflop_class_key("2-2-suited"))
        self.assertFalse(valid_preflop_class_key("5-2-offsuit"))
        self.assertFalse(valid_preflop_class_key("14-14-pair"))

    def test_random_interesting_hand_payload_skips_unsupported_player_counts(self) -> None:
        import sqlite3

        with tempfile.TemporaryDirectory() as temp_dir:
            db = Path(temp_dir) / "interesting.sqlite3"
            with closing(sqlite3.connect(db)) as connection:
                with connection:
                    connection.executescript(
                        """
                        CREATE TABLE interesting_hands (
                          hand_key TEXT PRIMARY KEY,
                          score REAL NOT NULL,
                          reasons_json TEXT NOT NULL,
                          metrics_json TEXT NOT NULL,
                          hand_json TEXT NOT NULL,
                          source_path TEXT NOT NULL,
                          selected_at TEXT NOT NULL
                        );
                        """
                    )
                    connection.executemany(
                        """
                        INSERT INTO interesting_hands (
                          hand_key, score, reasons_json, metrics_json, hand_json, source_path, selected_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        [
                            ("too-many", 99, "[]", json.dumps({"players": 9}), json.dumps({"source_hand_id": "bad"}), "x", "now"),
                            (
                                "six-max",
                                42,
                                json.dumps(["river decision"]),
                                json.dumps({"players": 6}),
                                json.dumps({
                                    "source_hand_id": "ok",
                                    "players": [
                                        {"position": "SB", "source_player_id": "p1", "hole_cards": ["As", "Kd"]},
                                        {"position": "BB", "source_player_id": "p2", "hole_cards": ["Qc", "Jh"]},
                                    ],
                                    "board": ["2s", "3h", "4d"],
                                    "actions": [{"player_id": "p1", "street": "preflop", "action_type": "raise"}],
                                }),
                                "x",
                                "now",
                            ),
                        ],
                    )

            payload = random_interesting_hand_payload(db)

        self.assertEqual(payload["handKey"], "six-max")
        self.assertEqual(payload["hand"]["source_hand_id"], "ok")

    def test_dashboard_compatible_interesting_hand_rejects_unmappable_actions(self) -> None:
        hand = {
            "players": [
                {"position": "SB", "source_player_id": "p1", "hole_cards": ["As", "Kd"]},
                {"position": "BB", "source_player_id": "p2", "hole_cards": ["Qc", "Jh"]},
            ],
            "board": ["2s", "3h", "4d"],
            "actions": [{"player_id": "p3", "street": "preflop", "action_type": "raise"}],
        }

        self.assertFalse(dashboard_compatible_interesting_hand(hand))
        hand["actions"][0]["player_id"] = "p1"
        self.assertTrue(dashboard_compatible_interesting_hand(hand))

    def test_wsgi_app_serves_health_and_static_assets(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "index.html").write_text("<h1>ok</h1>", encoding="utf-8")
            (root / "build_info.json").write_text(json.dumps({"version": "wsgi-test"}), encoding="utf-8")
            app = EssencePokerWsgiApp(cache=MemoryCache(), dashboard_root=root)

            health_status, _, health_body = call_wsgi(app, "/api/health")
            static_status, static_headers, static_body = call_wsgi(app, "/")

        self.assertTrue(health_status.startswith("200 "))
        self.assertEqual(json.loads(health_body)["build"]["version"], "wsgi-test")
        self.assertTrue(static_status.startswith("200 "))
        self.assertEqual(static_body, b"<h1>ok</h1>")
        self.assertIn(("Cache-Control", "no-cache"), static_headers)

    def test_wsgi_cache_put_requires_loopback_or_token(self) -> None:
        app = EssencePokerWsgiApp(cache=MemoryCache())

        denied_status, _, _ = call_wsgi(
            app,
            "/api/cache/example",
            method="PUT",
            body=b'{"ok":true}',
            remote_addr="203.0.113.10",
        )
        allowed_status, _, allowed_body = call_wsgi(
            app,
            "/api/cache/example",
            method="PUT",
            body=b'{"ok":true}',
            remote_addr="127.0.0.1",
        )

        self.assertTrue(denied_status.startswith("403 "))
        self.assertTrue(allowed_status.startswith("200 "))
        self.assertTrue(json.loads(allowed_body)["ok"])


def call_wsgi(app, path, *, method="GET", body=b"", remote_addr="127.0.0.1", headers=None):
    captured = {}

    def start_response(status, response_headers):
        captured["status"] = status
        captured["headers"] = response_headers

    environ = {
        "REQUEST_METHOD": method,
        "PATH_INFO": path,
        "QUERY_STRING": "",
        "REMOTE_ADDR": remote_addr,
        "CONTENT_LENGTH": str(len(body)) if body else "",
        "wsgi.input": BytesIO(body),
    }
    for key, value in (headers or {}).items():
        environ[f"HTTP_{key.upper().replace('-', '_')}"] = value
    response_body = b"".join(app(environ, start_response))
    return captured["status"], captured["headers"], response_body


if __name__ == "__main__":
    unittest.main()
