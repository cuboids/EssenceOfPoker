export function createComputationWorker(assetVersion, { onFailure = () => {} } = {}) {
  if (typeof Worker === "undefined") {
    return null;
  }

  let worker;
  try {
    worker = new Worker(`compute_worker.mjs?v=${assetVersion}`, { type: "module" });
  } catch (error) {
    reportWorkerFailure(onFailure, "startup", error);
    return null;
  }
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
    reportWorkerFailure(onFailure, "worker", error);
    for (const request of pending.values()) {
      request.reject(error);
    }
    pending.clear();
  });

  return {
    async computeWinShares(payload, fallback) {
      try {
        return withComputationMeta(
          await postWorkerRequest(worker, pending, nextId++, "computeWinShares", payload),
          { backend: "worker" },
        );
      } catch (error) {
        reportWorkerFailure(onFailure, "computeWinShares", error);
        return withComputationMeta(fallback(), {
          backend: "main-thread",
          fallbackFromWorker: true,
          fallbackReason: error?.message || "worker computation failed",
        });
      }
    },
    async computeMultiwayEquities(payload, fallback) {
      try {
        return withComputationMeta(
          await postWorkerRequest(worker, pending, nextId++, "computeMultiwayEquities", payload),
          { backend: "worker" },
        );
      } catch (error) {
        reportWorkerFailure(onFailure, "computeMultiwayEquities", error);
        return withComputationMeta(fallback(), {
          backend: "main-thread",
          fallbackFromWorker: true,
          fallbackReason: error?.message || "worker computation failed",
        });
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

function reportWorkerFailure(onFailure, type, error) {
  try {
    onFailure({
      type,
      message: error?.message || "worker computation failed",
      error,
      at: new Date().toISOString(),
    });
  } catch {
    // Observability callbacks should never break the main-thread fallback path.
  }
}

function postWorkerRequest(worker, pending, id, type, payload) {
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, payload });
  });
}

function withComputationMeta(result, computation) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return result;
  }
  return {
    ...result,
    computation: {
      ...(result.computation || {}),
      ...computation,
    },
  };
}
