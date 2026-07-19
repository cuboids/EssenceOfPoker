export function createComputationWorker(assetVersion) {
  if (typeof Worker === "undefined") {
    return null;
  }

  const worker = new Worker(`compute_worker.mjs?v=${assetVersion}`, { type: "module" });
  let nextId = 1;
  const pending = new Map();

  worker.addEventListener("message", (event) => {
    const { id, ok, result, error } = event.data || {};
    const request = pending.get(id);
    if (!request) {
      return;
    }
    pending.delete(id);
    if (ok) {
      request.resolve(result);
    } else {
      request.reject(new Error(error || "worker computation failed"));
    }
  });

  worker.addEventListener("error", (event) => {
    const error = new Error(event.message || "worker error");
    for (const request of pending.values()) {
      request.reject(error);
    }
    pending.clear();
  });

  return {
    async computeWinShares(payload, fallback) {
      try {
        return await postWorkerRequest(worker, pending, nextId++, "computeWinShares", payload);
      } catch {
        return fallback();
      }
    },
    async computeMultiwayEquities(payload, fallback) {
      try {
        return await postWorkerRequest(worker, pending, nextId++, "computeMultiwayEquities", payload);
      } catch {
        return fallback();
      }
    },
    cancelPending() {
      const error = new Error("worker computation cancelled");
      for (const id of pending.keys()) {
        worker.postMessage({ id, type: "cancel" });
        pending.get(id).reject(error);
      }
      pending.clear();
    },
  };
}

function postWorkerRequest(worker, pending, id, type, payload) {
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, payload });
  });
}
