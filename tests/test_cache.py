import os
import unittest
from unittest.mock import patch

from essence_of_poker.cache import MemoryCache, cache_from_environment


class CacheTests(unittest.TestCase):
    def test_memory_cache_round_trips_bytes(self) -> None:
        cache = MemoryCache()

        self.assertIsNone(cache.get("missing"))
        cache.set("key", b'{"ok":true}')

        self.assertEqual(cache.get("key"), b'{"ok":true}')

    def test_cache_from_environment_uses_memory_without_redis_url(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertIsInstance(cache_from_environment(), MemoryCache)


if __name__ == "__main__":
    unittest.main()
