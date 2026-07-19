import { fullDeck, cardId, sameCard } from "./cards.mjs";
import { cacheNamespace } from "./cache_keys.mjs";
import {
  DEFAULT_MULTIWAY_EQUITY_SIMS,
  multiwayEquityCacheKey,
  preflopMultiwayEquityCacheKey,
  removeKnownCards,
} from "./multiway_equity.mjs";
import { inferRanges } from "./range_inference.mjs";
import { hashString } from "./session_rng.mjs";

/**
 * @typedef {{ rank: number, suit: number, id?: number }} Card
 * @typedef {{ id: string, knownHoleCards?: Card[], rangeKey?: string, rangeCombos?: { cards: Card[], weight: number }[] }} EquityParticipant
 * @typedef {{ participants: EquityParticipant[], knownBoard: Card[], deadCards: Card[], deck: Card[], nsims: number, seed: number, bucketKeys?: string[], bucketCount?: number }} MultiwayEquityPayload
 */

/**
 * @param {{
 *   matchup: "actual" | "range",
 *   assetVersion: string | number,
 *   handState?: any,
 *   knownBoard?: Card[],
 *   knownCardsForHand?: Card[],
 *   activeVillainPageKeys?: string[],
 *   visibleActions?: any[],
 *   tableConfig?: any,
 *   dashboardData?: { bucketKeys?: string[], bucketCount?: number },
 *   evaluateGradation?: Function,
 *   empiricalSpots?: any,
 *   playerProfiles?: Record<string, any>,
 * }} options
 * @returns {MultiwayEquityPayload}
 */
export function buildMultiwayEquityPayload({
  matchup,
  assetVersion,
  handState = null,
  knownBoard = [],
  knownCardsForHand = [],
  activeVillainPageKeys = [],
  visibleActions = [],
  tableConfig = {},
  dashboardData = {},
  evaluateGradation = null,
  empiricalSpots = {},
  playerProfiles = {},
}) {
  const knownHeroCards = handState?.h1 && handState?.h2 ? [handState.h1, handState.h2] : [];
  const inferredRanges = inferredRangesForEquity({
    matchup,
    knownHeroCards,
    knownBoard,
    visibleActions,
    tableConfig,
    dashboardData,
    evaluateGradation,
    empiricalSpots,
    playerProfiles,
  });
  const participants = matchup === "range"
    ? [
      rangeParticipant("range", inferredRanges.hero),
      ...activeVillainPageKeys.map((page) => rangeParticipant(page, inferredRanges[page])),
    ]
    : [
      { id: "hero", knownHoleCards: knownHeroCards.length === 2 ? knownHeroCards : undefined },
      ...activeVillainPageKeys.map((page) => rangeParticipant(page, inferredRanges[page])),
    ];
  const knownUnavailableCards = matchup === "range"
    ? knownCardsForHand
    : [...knownHeroCards, ...knownBoard];
  return {
    bucketKeys: dashboardData.bucketKeys,
    bucketCount: dashboardData.bucketCount,
    participants,
    knownBoard,
    deadCards: knownUnavailableCards,
    deck: removeKnownCards(fullDeck, knownUnavailableCards),
    nsims: DEFAULT_MULTIWAY_EQUITY_SIMS,
    seed: hashString(`${assetVersion}:${matchup}:${JSON.stringify(knownUnavailableCards.map(cardId))}:${activeVillainPageKeys.join(",")}`),
  };
}

export function buildAggregateEquityCacheKey({
  matchup,
  payload,
  assetVersion,
  foldedPages = [],
  usesCanonicalCache = preflopAggregateEquityUsesCanonicalCache({ matchup, payload }),
}) {
  if (usesCanonicalCache) {
    return preflopMultiwayEquityCacheKey({
      namespace: cacheNamespace(assetVersion),
      matchup,
      heroCards: payload.participants.find((participant) => participant.id === "hero")?.knownHoleCards,
      activePlayerCount: payload.participants.length,
      nsims: payload.nsims,
    });
  }
  return multiwayEquityCacheKey({
    namespace: cacheNamespace(assetVersion),
    matchup,
    participants: payload.participants,
    knownBoard: payload.knownBoard,
    deadCards: payload.deadCards,
    foldedPages,
    nsims: payload.nsims,
  });
}

export function preflopAggregateEquityUsesCanonicalCache({
  matchup,
  payload,
  handRound = "preflop",
  visibleActions = [],
}) {
  return (
    matchup === "actual" &&
    handRound === "preflop" &&
    payload.knownBoard.length === 0 &&
    !visibleActions.some((action) => action.street === "preflop") &&
    payload.participants.some((participant) => participant.id === "hero" && participant.knownHoleCards?.length === 2)
  );
}

export function compactPreflopAggregateEquity(result, payload) {
  const villainIds = payload.participants.map((participant) => participant.id).filter((id) => id !== "hero");
  const villainShare = villainIds.length
    ? villainIds.reduce((total, id) => total + (result.equities[id] || 0), 0) / villainIds.length
    : 0;
  return {
    hero: result.equities.hero ?? 0,
    villain: villainShare,
    playerCount: payload.participants.length,
    nsims: result.nsims,
    exact: result.exact,
  };
}

export function expandCachedPreflopAggregateEquity(cached, payload) {
  if (!Number.isFinite(cached?.hero) || !Number.isFinite(cached?.villain)) {
    return cached;
  }
  return {
    equities: Object.fromEntries(
      payload.participants.map((participant) => [
        participant.id,
        participant.id === "hero" ? cached.hero : cached.villain,
      ]),
    ),
    nsims: cached.nsims,
    exact: cached.exact,
  };
}

export function participantHasNoLegalRange(participant, knownBoard = []) {
  if (!Array.isArray(participant?.rangeCombos)) {
    return false;
  }
  return !participant.rangeCombos.some((combo) =>
    Number(combo.weight) > 0 &&
    combo.cards?.length === 2 &&
    combo.cards.every((card) => !knownBoard.some((boardCard) => sameCard(card, boardCard))),
  );
}

function inferredRangesForEquity({
  matchup,
  knownHeroCards,
  knownBoard,
  visibleActions,
  tableConfig,
  dashboardData,
  evaluateGradation,
  empiricalSpots,
  playerProfiles,
}) {
  const deadCards = matchup === "range" ? knownBoard : [...knownHeroCards, ...knownBoard];
  if (!visibleActions.length) {
    return {};
  }
  return inferRanges({
    tableConfig,
    actions: visibleActions,
    deadCards,
    knownBoard,
    bucketCount: dashboardData.bucketCount,
    evaluateGradation,
    empiricalSpots,
    playerProfiles,
  });
}

function rangeParticipant(id, range) {
  if (!range) {
    return { id };
  }
  return {
    id,
    rangeKey: compactRangeKey(range),
    rangeCombos: range.combos.map((combo) => ({
      cards: combo.cards,
      weight: combo.weight,
    })),
  };
}

function compactRangeKey(range) {
  const historyKey = (range.history || [])
    .map((entry) => `${entry.action.type}:${entry.action.amount ?? ""}:${entry.targetFrequency?.toFixed?.(4) ?? ""}`)
    .join(",");
  return `${range.position || ""}:${range.summary.weightedCombos.toFixed(3)}:${historyKey}`;
}
