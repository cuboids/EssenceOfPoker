export function combinationsOfIndexes(values, size) {
  const combinations = [];
  const selected = [];

  function visit(start, depth) {
    if (depth === size) {
      combinations.push([...selected]);
      return;
    }
    const remainingNeeded = size - depth;
    for (let index = start; index <= values.length - remainingNeeded; index += 1) {
      selected[depth] = values[index];
      visit(index + 1, depth + 1);
    }
  }

  visit(0, 0);
  return combinations;
}

export const AGGREGATE_INDEX_GROUPS = Object.freeze({
  AGG: Object.freeze(combinationsOfIndexes([0, 1, 2, 3, 4, 5, 6], 5).map(Object.freeze)),
  AGG_BOTH: Object.freeze(combinationsOfIndexes([2, 3, 4, 5, 6], 3).map((combo) => Object.freeze([0, 1, ...combo]))),
  AGG_H1: Object.freeze(combinationsOfIndexes([2, 3, 4, 5, 6], 4).map((combo) => Object.freeze([0, ...combo]))),
  AGG_H2: Object.freeze(combinationsOfIndexes([2, 3, 4, 5, 6], 4).map((combo) => Object.freeze([1, ...combo]))),
  AGG_ZERO: Object.freeze([Object.freeze([2, 3, 4, 5, 6])]),
});

export function curveFromCounts(counts, totalCombos, bucketCount, priorXByGradation) {
  const curve = [];
  let cumulative = 0;
  let bestGradation = null;
  let worstGradation = null;
  for (let gradation = 1; gradation <= bucketCount; gradation += 1) {
    if (counts[gradation] > 0) {
      bestGradation = bestGradation ?? gradation;
      worstGradation = gradation;
    }
    cumulative += counts[gradation];
    curve.push({
      gradation,
      probability: cumulative / totalCombos,
      x: priorXByGradation.get(gradation),
    });
  }

  return { curve, totalCombos, bestGradation, worstGradation };
}

export function aggregateGradationsForSevenCards(cards, aggregateIndexGroups, bucketCount, evaluateGradation) {
  const best = {
    AGG: bucketCount,
    AGG_BOTH: bucketCount,
    AGG_H1: bucketCount,
    AGG_H2: bucketCount,
    AGG_ZERO: bucketCount,
  };

  for (const indexes of aggregateIndexGroups.AGG) {
    const gradation = evaluateGradation([
      cards[indexes[0]],
      cards[indexes[1]],
      cards[indexes[2]],
      cards[indexes[3]],
      cards[indexes[4]],
    ]);
    if (gradation < best.AGG) {
      best.AGG = gradation;
    }
    if (indexes.includes(0) && indexes.includes(1) && gradation < best.AGG_BOTH) {
      best.AGG_BOTH = gradation;
    } else if (indexes.includes(0) && !indexes.includes(1) && gradation < best.AGG_H1) {
      best.AGG_H1 = gradation;
    } else if (indexes.includes(1) && !indexes.includes(0) && gradation < best.AGG_H2) {
      best.AGG_H2 = gradation;
    }
  }
  best.AGG_ZERO = evaluateGradation([cards[2], cards[3], cards[4], cards[5], cards[6]]);

  return best;
}
