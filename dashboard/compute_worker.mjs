import { createHandEvaluator } from "./evaluation.mjs";
import {
  computePreflopHeroWinSharesKernel,
  computeRunoutWinShares,
} from "./win_shares.mjs";

let evaluator = null;
let evaluatorKey = "";
const cancelledIds = new Set();

self.addEventListener("message", (event) => {
  const { id, type, payload } = event.data || {};
  if (type === "cancel") {
    cancelledIds.add(id);
    return;
  }
  if (type !== "computeWinShares") {
    return;
  }

  try {
    const result = computeWinShares(payload);
    if (!cancelledIds.has(id)) {
      self.postMessage({ id, ok: true, result });
    }
  } catch (error) {
    if (!cancelledIds.has(id)) {
      self.postMessage({ id, ok: false, error: error.message });
    }
  } finally {
    cancelledIds.delete(id);
  }
});

function computeWinShares(payload) {
  const handEvaluator = evaluatorFor(payload.bucketKeys, payload.bucketCount);
  if (payload.kind === "heroPreflop") {
    return computePreflopHeroWinSharesKernel({
      portfolio: payload.portfolio,
      handState: reviveHandState(payload.handState),
      remainingDeck: payload.remainingDeck,
      evaluateGradationFive: handEvaluator.evaluateGradationFive,
    });
  }

  return computeRunoutWinShares({
    portfolio: payload.portfolio,
    knownState: payload.knownState,
    remainingDeck: payload.remainingDeck,
    suitMap: new Map(payload.suitMapEntries || []),
    evaluateGradation: handEvaluator.evaluateGradation,
  });
}

function evaluatorFor(bucketKeys, bucketCount) {
  const nextKey = `${bucketCount}:${bucketKeys.length}`;
  if (!evaluator || evaluatorKey !== nextKey) {
    evaluator = createHandEvaluator(new Map(bucketKeys.map((bucket) => [bucket.key, bucket.gradation])), bucketCount);
    evaluatorKey = nextKey;
  }
  return evaluator;
}

function reviveHandState(handState) {
  return {
    ...handState,
    suitMap: new Map(handState.suitMapEntries || []),
  };
}
