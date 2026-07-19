import assert from "node:assert/strict";
import test from "node:test";

import { createComputationWorker } from "../dashboard/computation_worker_client.mjs";

test("computation worker reports task failures before using fallback", async () => {
  const failures = [];
  withFakeWorker(class {
    constructor() {
      this.listeners = {};
    }

    addEventListener(type, listener) {
      this.listeners[type] = listener;
    }

    postMessage(message) {
      if (message.type === "cancel") {
        return;
      }
      queueMicrotask(() => {
        this.listeners.message({ data: { id: message.id, ok: false, error: "boom" } });
      });
    }
  });

  try {
    const worker = createComputationWorker("test", { onFailure: (failure) => failures.push(failure) });
    const result = await worker.computeWinShares({}, () => ({ fallback: true }));

    assert.deepEqual(result, {
      fallback: true,
      computation: {
        backend: "main-thread",
        fallbackFromWorker: true,
        fallbackReason: "boom",
      },
    });
    assert.equal(failures.length, 1);
    assert.equal(failures[0].type, "computeWinShares");
    assert.equal(failures[0].message, "boom");
  } finally {
    restoreWorker();
  }
});

test("computation worker marks successful worker results", async () => {
  withFakeWorker(class {
    constructor() {
      this.listeners = {};
    }

    addEventListener(type, listener) {
      this.listeners[type] = listener;
    }

    postMessage(message) {
      queueMicrotask(() => {
        this.listeners.message({ data: { id: message.id, ok: true, result: { ok: true } } });
      });
    }
  });

  try {
    const worker = createComputationWorker("test");
    const result = await worker.computeMultiwayEquities({}, () => ({ fallback: true }));

    assert.deepEqual(result, { ok: true, computation: { backend: "worker" } });
  } finally {
    restoreWorker();
  }
});

test("computation worker reports startup failures", () => {
  const failures = [];
  withFakeWorker(class {
    constructor() {
      throw new Error("cannot start");
    }
  });

  try {
    const worker = createComputationWorker("test", { onFailure: (failure) => failures.push(failure) });

    assert.equal(worker, null);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].type, "startup");
  } finally {
    restoreWorker();
  }
});

let originalWorker;

function withFakeWorker(workerClass) {
  originalWorker = globalThis.Worker;
  globalThis.Worker = workerClass;
}

function restoreWorker() {
  if (originalWorker === undefined) {
    delete globalThis.Worker;
  } else {
    globalThis.Worker = originalWorker;
  }
}
