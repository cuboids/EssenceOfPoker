import assert from "node:assert/strict";
import test from "node:test";

import { createAsyncJobRunner } from "../dashboard/async_jobs.mjs";

test("async job runner deduplicates keyed jobs and runs current guards only", async () => {
  const scheduled = [];
  const runner = createAsyncJobRunner({
    setTimeoutRef(callback) {
      scheduled.push(callback);
      return scheduled.length;
    },
    clearTimeoutRef() {},
  });
  let current = true;
  let runs = 0;

  assert.equal(runner.schedule({
    key: "curves:hero",
    guard: { isCurrent: () => current },
    run: () => { runs += 1; },
  }), true);
  assert.equal(runner.schedule({
    key: "curves:hero",
    run: () => { runs += 10; },
  }), false);
  assert.equal(runner.size(), 1);

  current = false;
  await scheduled[0]();
  assert.equal(runs, 0);
  assert.equal(runner.size(), 0);
});

test("async job runner cancels by prefix and reports errors", async () => {
  const scheduled = [];
  const failures = [];
  const runner = createAsyncJobRunner({
    setTimeoutRef(callback) {
      scheduled.push(callback);
      return scheduled.length;
    },
    clearTimeoutRef() {},
    onError: (failure) => failures.push(failure),
  });

  runner.schedule({ key: "equity:hero", run: () => {} });
  runner.schedule({ key: "equity:villain", run: () => {} });
  runner.schedule({ key: "curves:hero", run: () => { throw new Error("boom"); } });

  assert.equal(runner.cancelByPrefix("equity:"), 2);
  assert.equal(runner.size(), 1);
  await scheduled[2]();
  assert.equal(failures.length, 1);
  assert.equal(failures[0].key, "curves:hero");
});
