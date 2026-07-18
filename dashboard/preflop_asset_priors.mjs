import { flopCardCompare } from "./hand_state.mjs";
import { curveFromCounts } from "./portfolio_curves.mjs";
import { tokenIndexForWinShare } from "./win_shares.mjs";

export function computePreflopHeroAssetPriorKernel({
  portfolio,
  handState,
  remainingDeck,
  bucketCount,
  evaluateGradationFive,
}) {
  const plans = portfolio.assets.map((asset) => ({
    code: asset.code,
    indexes: asset.name.split(" + ").map(tokenIndexForWinShare),
  }));
  const countsByCode = Object.fromEntries(
    portfolio.assets.map((asset) => [asset.code, new Uint32Array(bucketCount + 1)]),
  );
  const baseCards = [handState.h1, handState.h2, null, null, null, null, null];
  const physicalGradations = new Uint16Array(128);
  const boardIndexes = [0, 1, 2, 3, 4];
  let totalCombos = 0;

  for (let firstBoard = 0; firstBoard < remainingDeck.length - 4; firstBoard += 1) {
    baseCards[2] = remainingDeck[firstBoard];
    for (let secondBoard = firstBoard + 1; secondBoard < remainingDeck.length - 3; secondBoard += 1) {
      baseCards[3] = remainingDeck[secondBoard];
      for (let thirdBoard = secondBoard + 1; thirdBoard < remainingDeck.length - 2; thirdBoard += 1) {
        baseCards[4] = remainingDeck[thirdBoard];
        for (let fourthBoard = thirdBoard + 1; fourthBoard < remainingDeck.length - 1; fourthBoard += 1) {
          baseCards[5] = remainingDeck[fourthBoard];
          for (let fifthBoard = fourthBoard + 1; fifthBoard < remainingDeck.length; fifthBoard += 1) {
            baseCards[6] = remainingDeck[fifthBoard];
            markPhysicalGradations(baseCards, physicalGradations, evaluateGradationFive);
            totalCombos += accumulatePreflopAssetArrangementCounts(
              baseCards,
              boardIndexes,
              plans,
              physicalGradations,
              countsByCode,
              handState.suitMap,
            );
          }
        }
      }
    }
  }

  return {
    totalCombos,
    countsByCode,
  };
}

export function curvesFromPreflopAssetPriorCounts({ countsByCode, totalCombos, bucketCount, priorXByGradation }) {
  return Object.fromEntries(
    Object.entries(countsByCode).map(([code, counts]) => [
      code,
      curveFromCounts(counts, totalCombos, bucketCount, priorXByGradation),
    ]),
  );
}

function markPhysicalGradations(baseCards, physicalGradations, evaluateGradationFive) {
  physicalGradations.fill(0);
  for (let first = 0; first < 3; first += 1) {
    for (let second = first + 1; second < 4; second += 1) {
      for (let third = second + 1; third < 5; third += 1) {
        for (let fourth = third + 1; fourth < 6; fourth += 1) {
          for (let fifth = fourth + 1; fifth < 7; fifth += 1) {
            const mask = (1 << first) | (1 << second) | (1 << third) | (1 << fourth) | (1 << fifth);
            physicalGradations[mask] = evaluateGradationFive(
              baseCards[first],
              baseCards[second],
              baseCards[third],
              baseCards[fourth],
              baseCards[fifth],
            );
          }
        }
      }
    }
  }
}

function accumulatePreflopAssetArrangementCounts(
  baseCards,
  boardIndexes,
  plans,
  physicalGradations,
  countsByCode,
  suitMap,
) {
  let totalCombos = 0;
  for (let first = 0; first < boardIndexes.length - 2; first += 1) {
    for (let second = first + 1; second < boardIndexes.length - 1; second += 1) {
      for (let third = second + 1; third < boardIndexes.length; third += 1) {
        const rawFlop = [boardIndexes[first] + 2, boardIndexes[second] + 2, boardIndexes[third] + 2];
        const flop = rawFlop.sort((left, right) => flopCardCompare(baseCards[left], baseCards[right], suitMap));
        const streets = [0, 1, 2, 3, 4]
          .filter((index) => index !== boardIndexes[first] && index !== boardIndexes[second] && index !== boardIndexes[third])
          .map((index) => index + 2);

        accumulatePreflopAssetCountsForLayout([0, 1, flop[0], flop[1], flop[2], streets[0], streets[1]], plans, physicalGradations, countsByCode);
        accumulatePreflopAssetCountsForLayout([0, 1, flop[0], flop[1], flop[2], streets[1], streets[0]], plans, physicalGradations, countsByCode);
        totalCombos += 2;
      }
    }
  }
  return totalCombos;
}

function accumulatePreflopAssetCountsForLayout(positionToBaseIndex, plans, physicalGradations, countsByCode) {
  for (const plan of plans) {
    const mask =
      (1 << positionToBaseIndex[plan.indexes[0]]) |
      (1 << positionToBaseIndex[plan.indexes[1]]) |
      (1 << positionToBaseIndex[plan.indexes[2]]) |
      (1 << positionToBaseIndex[plan.indexes[3]]) |
      (1 << positionToBaseIndex[plan.indexes[4]]);
    countsByCode[plan.code][physicalGradations[mask]] += 1;
  }
}
