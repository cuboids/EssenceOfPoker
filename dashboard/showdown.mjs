import { bettingStateForStreet, formatAmount, playerHasFoldedByStreet } from "./player_actions.mjs";
import { bestSevenCardGradation } from "./multiway_equity.mjs";

export function computeShowdownSettlement({
  participants,
  board,
  actions,
  order,
  stacks,
  smallBlindPlayer,
  bigBlindPlayer,
  evaluateGradationFive,
}) {
  const state = bettingStateForStreet({
    actions,
    street: "river",
    order,
    stacks,
    smallBlindPlayer,
    bigBlindPlayer,
  });
  const participantById = new Map(participants.map((participant) => [participant.id, participant]));
  const rows = participants.map((participant) => {
    const folded = participant.folded ?? playerHasFoldedByStreet(actions, participant.id, "river");
    const hasCompleteHand = Array.isArray(participant.holeCards) && participant.holeCards.length === 2 && board.length === 5;
    const gradation = !folded && hasCompleteHand
      ? bestSevenCardGradation([...participant.holeCards, ...board], evaluateGradationFive)
      : null;
    return {
      ...participant,
      folded,
      contribution: state.totalInvested(participant.id),
      gradation,
      winnings: 0,
      net: -state.totalInvested(participant.id),
      complete: folded || hasCompleteHand,
    };
  });
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const liveRows = rows.filter((row) => !row.folded);
  const potSize = rows.reduce((total, row) => total + row.contribution, 0);
  const missingShowdownCards = liveRows.filter((row) => row.gradation == null);
  if (!liveRows.length || missingShowdownCards.length) {
    return {
      complete: false,
      reason: !liveRows.length ? "No live players remain." : "Showdown cards are not known for every live player.",
      potSize,
      rows,
      pots: [],
      winners: [],
    };
  }

  const pots = sidePots(rows).map((pot) => {
    const eligibleRows = pot.eligibleIds.map((id) => rowById.get(id)).filter(Boolean);
    const bestGradation = Math.min(...eligibleRows.map((row) => row.gradation));
    const winners = eligibleRows.filter((row) => row.gradation === bestGradation);
    const amountPerWinner = pot.amount / winners.length;
    for (const winner of winners) {
      winner.winnings += amountPerWinner;
      winner.net += amountPerWinner;
    }
    return {
      ...pot,
      bestGradation,
      winnerIds: winners.map((winner) => winner.id),
      amountPerWinner,
    };
  });

  rows.sort((first, second) =>
    second.winnings - first.winnings ||
    Number(first.folded) - Number(second.folded) ||
    (first.gradation ?? Infinity) - (second.gradation ?? Infinity) ||
    first.label.localeCompare(second.label),
  );

  return {
    complete: true,
    potSize,
    rows,
    pots,
    winners: rows.filter((row) => row.winnings > 0),
  };
}

export function sidePots(rows) {
  const levels = [...new Set(rows.map((row) => row.contribution).filter((amount) => amount > 0))]
    .sort((first, second) => first - second);
  let previousLevel = 0;
  return levels.map((level, index) => {
    const contributorIds = rows.filter((row) => row.contribution >= level).map((row) => row.id);
    const eligibleIds = rows
      .filter((row) => !row.folded && row.contribution >= level)
      .map((row) => row.id);
    const amount = (level - previousLevel) * contributorIds.length;
    previousLevel = level;
    return {
      index,
      amount,
      contributorIds,
      eligibleIds,
      label: index === 0 ? "Main pot" : `Side pot ${index}`,
    };
  }).filter((pot) => pot.amount > 0 && pot.eligibleIds.length > 0);
}

export function formatChipAmount(value) {
  const rounded = Math.round((Number(value) || 0) * 10) / 10;
  if (Math.abs(rounded) < 0.0001) {
    return "0";
  }
  return `${rounded < 0 ? "-" : ""}${formatAmount(Math.abs(rounded))}`;
}
