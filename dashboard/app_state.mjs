import * as HandModel from "./hand_state.mjs";
import { handViewFromModel } from "./hand_view.mjs";
import { readPersistedUiState } from "./local_storage_schema.mjs";

export function createAppState({ assetVersion, localStorageRef = globalThis.localStorage } = {}) {
  const persistedUi = readPersistedUiState(localStorageRef);
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
      view: null,
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
      workerFailures: [],
    },
    ui: {
      focusedAsset: null,
      activePage: "hero",
      editingCardToken: null,
      cardEditError: "",
      chartMode: "bell",
      useDarkTheme: persistedUi.useDarkTheme,
      hideInactiveAssets: persistedUi.hideInactiveAssets,
      tableConfig: {
        playerCount: persistedUi.tableConfig.playerCount,
        heroPosition: persistedUi.tableConfig.heroPosition,
        foldedVillainPositions: [],
        playerStacks: persistedUi.tableConfig.playerStacks,
      },
      calibrationContext: persistedUi.calibrationContext,
      playerProfiles: persistedUi.playerProfiles,
    },
  };
}

export function initializeHandState(state) {
  state.hand.view = handViewFromModel(state.hand.model);
  state.hand.villainShowdown = HandModel.isShowdown(state.hand.model);
  return state;
}

export function resetComputedState(state) {
  state.computed.curves = {};
  state.computed.winShares = {};
  state.computed.curveToken += 1;
}
