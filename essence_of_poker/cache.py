"""Small cache boundary with optional Redis support."""

from __future__ import annotations

import os

import redis


class CacheBackend:
    """Cache interface used by the local dashboard server."""

    name = "memory"
    redis_url_configured = False
    redis_available = False
    fallback_reason: str | None = None

    def get(self, key: str) -> bytes | None:
        raise NotImplementedError

    def set(self, key: str, value: bytes, *, ttl_seconds: int | None = None) -> None:
        raise NotImplementedError

    def status(self) -> dict:
        return {
            "backend": self.name,
            "redisUrlConfigured": self.redis_url_configured,
            "redisAvailable": self.redis_available,
            "fallbackReason": self.fallback_reason,
        }


class MemoryCache(CacheBackend):
    """Process-local fallback for development without Redis."""

    name = "memory"

    def __init__(self, *, redis_url_configured: bool = False, fallback_reason: str | None = None) -> None:
        self._values: dict[str, bytes] = {}
        self.redis_url_configured = redis_url_configured
        self.fallback_reason = fallback_reason

    def get(self, key: str) -> bytes | None:
        return self._values.get(key)

    def set(self, key: str, value: bytes, *, ttl_seconds: int | None = None) -> None:
        self._values[key] = value


class RedisCache(CacheBackend):
    """Redis-backed cache using the official Python client."""

    name = "redis"
    redis_url_configured = True
    redis_available = True

    def __init__(self, redis_url: str) -> None:
        self._client = redis.Redis.from_url(redis_url, socket_connect_timeout=1.5, socket_timeout=1.5)

    def get(self, key: str) -> bytes | None:
        value = self._client.get(key)
        return value if isinstance(value, bytes) else None

    def set(self, key: str, value: bytes, *, ttl_seconds: int | None = None) -> None:
        self._client.set(key, value, ex=ttl_seconds)


def cache_from_environment() -> CacheBackend:
    """Return Redis when REDIS_URL works, otherwise a memory cache."""

    redis_url = os.environ.get("REDIS_URL")
    if not redis_url:
        return MemoryCache()

    cache = RedisCache(redis_url)
    try:
        cache.set("eop:healthcheck", b"ok", ttl_seconds=5)
    except redis.RedisError as exc:
        return MemoryCache(redis_url_configured=True, fallback_reason=exc.__class__.__name__)
    return cache
