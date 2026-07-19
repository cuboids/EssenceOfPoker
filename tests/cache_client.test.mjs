import assert from "node:assert/strict";
import test from "node:test";

import {
  readApiCache,
  readApiCacheResult,
  writeApiCache,
  writeApiCacheResult,
} from "../dashboard/cache_client.mjs";

test("cache writes can be cancelled before fetch when async state is stale", () => {
  const calls = withFetchRecorder(() => {
    writeApiCache("stale-key", { ok: true }, { shouldWrite: () => false });
  });

  assert.equal(calls.length, 0);
});

test("cache writes validate payloads before fetch", () => {
  const calls = withFetchRecorder(() => {
    writeApiCache("bad-key", { ok: false }, {
      validator: () => {
        throw new Error("bad payload");
      },
    });
  });

  assert.equal(calls.length, 0);
});

test("cache writes use the encoded key and serialized validated payload", () => {
  const calls = withFetchRecorder(() => {
    writeApiCache("family:key with spaces", { ok: true }, {
      validator: (payload) => ({ ...payload, validated: true }),
    });
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "api/cache/family%3Akey%20with%20spaces");
  assert.equal(calls[0].options.method, "PUT");
  assert.equal(calls[0].options.body, JSON.stringify({ ok: true, validated: true }));
});

test("cache reads expose typed miss, validation, and network results", async () => {
  await withFetchStub(async () => ({ ok: false, status: 404, statusText: "Not Found" }), async () => {
    const result = await readApiCacheResult("missing");
    assert.deepEqual(result, { ok: false, status: 404, reason: "miss", error: "Not Found" });
    assert.equal(await readApiCache("missing"), null);
  });

  await withFetchStub(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  }), async () => {
    const result = await readApiCacheResult("bad", {
      validator: () => {
        throw new Error("bad shape");
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "validation");
    assert.equal(result.error, "bad shape");
  });

  await withFetchStub(async () => {
    throw new Error("offline");
  }, async () => {
    const result = await readApiCacheResult("offline");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "network");
    assert.equal(result.error, "offline");
  });
});

test("cache writes can return typed results for migrated callers", async () => {
  await withFetchStub(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, cache: "memory" }),
  }), async () => {
    const result = await writeApiCacheResult("key", { ok: true });
    assert.equal(result.ok, true);
    assert.equal(result.value.cache, "memory");
  });

  const cancelled = await writeApiCacheResult("key", { ok: true }, { shouldWrite: () => false });
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.reason, "cancelled");
});

function withFetchRecorder(fn) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = (url, options) => {
    calls.push({ url, options });
    return Promise.resolve({ ok: true });
  };
  try {
    fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
  return calls;
}

async function withFetchStub(fetchStub, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchStub;
  try {
    await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}
