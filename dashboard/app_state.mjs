import * as HandModel from "./hand_state.mjs";

export function createAppState({ assetVersion, localStorageRef = globalThis.localStorage } = {}) {
  const storedPlayerCount = Number(localStorageRef?.getItem("essence-player-count") || 2);
  const storedHeroPosition = localStorageRef?.getItem("essence-hero-position") || null;
  const storedPlayerStacks = parseStoredObject(localStorageRef?.getItem("essence-player-stacks"));
  return {
    assetVersion: assetVersion || Date.now(),
    data: {
      dashboard: null,
      bucketLookup: null,
      handEvaluator: null,
      priorXByGradation: null,
      aggregatePriorXByGradation: null,
      priorNaturalXMaps: {},
      categoryByGradation: null,
      preflopAggregateClasses: {},
      preflopHiddenVillainClasses: {},
      preflopHandEquityCache: null,
    },
    hand: {
      model: HandModel.emptyHandModel(),
      legacy: null,
      timeline: [],
      viewedStreetIndex: -1,
      villainShowdown: false,
      playerActions: [],
    },
    computed: {
      curves: {},
      winShares: {},
      curveToken: 0,
      villainMirrorScheduled: false,
      winShareScheduled: false,
      worker: null,
    },
    ui: {
      focusedAsset: null,
      activePage: "hero",
      editingCardToken: null,
      cardEditError: "",
      chartMode: "bell",
      useDarkTheme: localStorageRef?.getItem("essence-theme") === "dark",
      hideInactiveAssets: localStorageRef?.getItem("essence-hide-inactive-assets") === "true",
      tableConfig: {
        playerCount: storedPlayerCount,
        heroPosition: storedHeroPosition,
        foldedVillainPositions: [],
        playerStacks: storedPlayerStacks,
      },
    },
  };
}

function parseStoredObject(rawValue) {
  if (!rawValue) {
    return {};
  }
  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function initializeHandState(state) {
  state.hand.legacy = HandModel.legacyHandState(state.hand.model);
  state.hand.villainShowdown = HandModel.isShowdown(state.hand.model);
  return state;
}

export function resetComputedState(state) {
  state.computed.curves = {};
  state.computed.winShares = {};
  state.computed.curveToken += 1;
}
