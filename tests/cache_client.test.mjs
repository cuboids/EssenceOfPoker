import assert from "node:assert/strict";
import test from "node:test";

import { writeApiCache } from "../dashboard/cache_client.mjs";

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
