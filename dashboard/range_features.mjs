export function preflopComboFeatures(combo) {
  const [first, second] = combo.cards;
  const high = Math.min(first.rank, second.rank);
  const low = Math.max(first.rank, second.rank);
  const isPair = first.rank === second.rank;
  const isSuited = first.suit === second.suit;
  const gap = Math.max(0, low - high - 1);
  const broadwayCount = [first, second].filter((card) => card.rank <= 5).length;
  const aceCount = [first, second].filter((card) => card.rank === 1).length;

  return {
    high,
    low,
    isPair,
    isSuited,
    gap,
    broadwayCount,
    aceCount,
    pairStrength: isPair ? (14 - high) / 13 : 0,
    highCardStrength: (14 - high) / 13,
    lowCardStrength: (14 - low) / 13,
    connectedness: Math.max(0, 1 - gap / 5),
  };
}

export function preflopComboScore(combo, profile = {}) {
  const features = preflopComboFeatures(combo);
  const profileAggression = Number(profile.preflopAggression || 0);
  const suitedAffinity = Number(profile.suitedAffinity || 0);
  const pairAffinity = Number(profile.pairAffinity || 0);
  const broadwayAffinity = Number(profile.broadwayAffinity || 0);

  let score =
    0.52 * features.highCardStrength +
    0.28 * features.lowCardStrength +
    0.22 * features.connectedness +
    0.16 * features.broadwayCount +
    0.09 * features.aceCount;
  if (features.isPair) {
    score += 0.42 + 0.44 * features.pairStrength + pairAffinity;
  }
  if (features.isSuited) {
    score += 0.14 + suitedAffinity;
  }
  if (features.gap >= 4 && !features.isPair) {
    score -= 0.08;
  }
  score += broadwayAffinity * features.broadwayCount;
  score += profileAggression;
  return score;
}
