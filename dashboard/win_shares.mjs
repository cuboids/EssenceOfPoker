import { sameCard } from "./cards.mjs";
import { flopCardCompare } from "./hand_state.mjs";
import { AGGREGATE_INDEX_GROUPS } from "./portfolio_curves.mjs";

export function indexesToMask(indexes) {
  return indexes.reduce((mask, index) => mask | (1 << index), 0);
}

export function tokenIndexForWinShare(token) {
  return {
    H_1: 0,
    H_2: 1,
    F_1: 2,
    F_2: 3,
    F_3: 4,
    T: 5,
    R: 6,
  }[token];
}

export function accumulatePreflopOrderedStreetShare(positionToBaseIndex, plans, winningMasks, shareValues) {
  const winningPlanIndexes = [];
  for (let planIndex = 0; planIndex < plans.length; planIndex += 1) {
    const plan = plans[planIndex];
    const mask =
      (1 << positionToBaseIndex[plan[0]]) |
      (1 << positionToBaseIndex[plan[1]]) |
      (1 << positionToBaseIndex[plan[2]]) |
      (1 << positionToBaseIndex[plan[3]]) |
      (1 << positionToBaseIndex[plan[4]]);
    if (winningMasks[mask]) {
      winningPlanIndexes.push(planIndex);
    }
  }
  const splitShare = 1 / winningPlanIndexes.length;
  for (const planIndex of winningPlanIndexes) {
    shareValues[planIndex] += splitShare;
  }
  return 1;
}

export function computeRunoutWinShares({ portfolio, knownState, remainingDeck, suitMap, evaluateGradation }) {
  const assetPlans = portfolio.assets.map((asset) => ({
    asset,
    tokens: asset.name.split(" + "),
  }));
  const shares = Object.fromEntries(portfolio.assets.map((asset) => [asset.code, 0]));
  let totalCombos = 0;

  function scoreCompletedState(completedState) {
    const gradations = assetPlans.map((plan) => ({
      code: plan.asset.code,
      gradation: evaluateGradation(plan.tokens.map((token) => completedState[token])),
    }));
    const bestGradation = Math.min(...gradations.map((result) => result.gradation));
    const winners = gradations.filter((result) => result.gradation === bestGradation);
    const splitShare = 1 / winners.length;
    for (const winner of winners) {
      shares[winner.code] += splitShare;
    }
    totalCombos += 1;
  }

  function visitRiver(state, deck) {
    if (state.R) {
      scoreCompletedState(state);
      return;
    }
    for (let index = 0; index < deck.length; index += 1) {
      visitRiver({ ...state, R: deck[index] }, deck.filter((_, deckIndex) => deckIndex !== index));
    }
  }

  function visitTurn(state, deck) {
    if (state.T) {
      visitRiver(state, deck);
      return;
    }
    for (let index = 0; index < deck.length; index += 1) {
      visitTurn({ ...state, T: deck[index] }, deck.filter((_, deckIndex) => deckIndex !== index));
    }
  }

  function visitFlop(start, selected, state, deck, missingCount) {
    if (selected.length === missingCount) {
      const flop = [state.F_1, state.F_2, state.F_3, ...selected]
        .filter(Boolean)
        .sort((first, second) => flopCardCompare(first, second, suitMap || new Map()));
      visitTurn(
        { ...state, F_1: flop[0], F_2: flop[1], F_3: flop[2] },
        deck.filter((card) => !selected.some((selectedCard) => sameCard(card, selectedCard))),
      );
      return;
    }

    const remainingNeeded = missingCount - selected.length;
    for (let index = start; index <= deck.length - remainingNeeded; index += 1) {
      selected.push(deck[index]);
      visitFlop(index + 1, selected, state, deck, missingCount);
      selected.pop();
    }
  }

  const missingFlopCount = ["F_1", "F_2", "F_3"].filter((token) => !knownState[token]).length;
  if (missingFlopCount > 0) {
    visitFlop(0, [], knownState, remainingDeck, missingFlopCount);
  } else {
    visitTurn(knownState, remainingDeck);
  }

  for (const code of Object.keys(shares)) {
    shares[code] = totalCombos > 0 ? shares[code] / totalCombos : 0;
  }
  return { shares, totalCombos };
}

export function computePreflopHeroWinSharesKernel({
  portfolio,
  handState,
  remainingDeck,
  evaluateGradationFive,
  aggregateIndexGroups = AGGREGATE_INDEX_GROUPS,
}) {
  const plans = portfolio.assets.map((asset) => asset.name.split(" + ").map(tokenIndexForWinShare));
  const shareValues = new Float64Array(portfolio.assets.length);
  const baseCards = [handState.h1, handState.h2, null, null, null, null, null];
  const winningMasks = new Uint8Array(128);
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
            markWinningPhysicalMasks(baseCards, winningMasks, aggregateIndexGroups, evaluateGradationFive);
            totalCombos += accumulatePreflopArrangementShares(baseCards, boardIndexes, plans, winningMasks, shareValues, handState.suitMap);
          }
        }
      }
    }
  }

  return sharesFromValues(portfolio, shareValues, totalCombos);
}

export function computePreflopHeroWinSharesBruteForce({
  portfolio,
  handState,
  remainingDeck,
  evaluateGradation,
}) {
  const knownState = { H_1: handState.h1, H_2: handState.h2 };
  return computeRunoutWinShares({
    portfolio,
    knownState,
    remainingDeck,
    suitMap: handState.suitMap,
    evaluateGradation,
  });
}

export function markWinningPhysicalMasks(baseCards, winningMasks, aggregateIndexGroups, evaluateGradationFive) {
  winningMasks.fill(0);
  let bestGradation = Infinity;
  for (const indexes of aggregateIndexGroups.AGG) {
    const gradation = evaluateGradationFive(
      baseCards[indexes[0]],
      baseCards[indexes[1]],
      baseCards[indexes[2]],
      baseCards[indexes[3]],
      baseCards[indexes[4]],
    );
    const mask = indexesToMask(indexes);
    if (gradation < bestGradation) {
      winningMasks.fill(0);
      winningMasks[mask] = 1;
      bestGradation = gradation;
    } else if (gradation === bestGradation) {
      winningMasks[mask] = 1;
    }
  }
}

export function accumulatePreflopArrangementShares(baseCards, boardIndexes, plans, winningMasks, shareValues, suitMap) {
  let totalCombos = 0;
  for (let first = 0; first < boardIndexes.length - 2; first += 1) {
    for (let second = first + 1; second < boardIndexes.length - 1; second += 1) {
      for (let third = second + 1; third < boardIndexes.length; third += 1) {
        const rawFlop = [boardIndexes[first] + 2, boardIndexes[second] + 2, boardIndexes[third] + 2];
        const flop = rawFlop.sort((left, right) => flopCardCompare(baseCards[left], baseCards[right], suitMap));
        const streets = [0, 1, 2, 3, 4]
          .filter((index) => index !== boardIndexes[first] && index !== boardIndexes[second] && index !== boardIndexes[third])
          .map((index) => index + 2);

        totalCombos += accumulatePreflopOrderedStreetShare([0, 1, flop[0], flop[1], flop[2], streets[0], streets[1]], plans, winningMasks, shareValues);
        totalCombos += accumulatePreflopOrderedStreetShare([0, 1, flop[0], flop[1], flop[2], streets[1], streets[0]], plans, winningMasks, shareValues);
      }
    }
  }
  return totalCombos;
}

function sharesFromValues(portfolio, shareValues, totalCombos) {
  const shares = {};
  for (const [index, asset] of portfolio.assets.entries()) {
    shares[asset.code] = totalCombos > 0 ? shareValues[index] / totalCombos : 0;
  }
  return { shares, totalCombos };
}
