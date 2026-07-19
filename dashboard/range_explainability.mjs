export function rangeExplanation(range) {
  const last = range?.history?.at?.(-1);
  if (!last) {
    return "Uniform range before action evidence";
  }
  if (last.empirical) {
    const request = last.request || {};
    const action = last.action || {};
    return [
      "Empirical PHH baseline",
      request.street,
      request.position,
      `${request.playerCount || "?"}-player`,
      request.facingAggression ? "facing aggression" : "unopened/no prior aggression",
      request.amountBucket ? `${request.amountBucket} sizing` : null,
      action.type ? `observed ${action.type}` : null,
    ].filter(Boolean).join(" · ");
  }
  if (Number.isFinite(last.targetFrequency)) {
    return `Heuristic range update · observed ${last.action?.type || "action"} · target ${formatPercent(last.targetFrequency)}`;
  }
  return "Range updated from action history";
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}
