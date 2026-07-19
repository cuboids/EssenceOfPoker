import { bindConfigControls } from "./controllers/dashboard_controls.mjs";
import { renderConfigPageHtml } from "./renderers/config_renderer.mjs";
import { ARCHETYPE_NAMES } from "./player_archetypes.mjs";
import {
  PLAYER_COUNTS,
  TABLE_POSITIONS,
  normalizeTableConfig,
  positionDisplayName,
  positionFromPageKey,
} from "./table_positions.mjs";

export function createConfigPageController(deps) {
  function renderConfigPage() {
    const container = deps.documentRef.getElementById("asset-grid");
    const tableConfig = deps.tableConfig();
    const normalized = normalizeTableConfig(tableConfig);
    container.innerHTML = renderConfigPageHtml({
      normalized,
      hideInactiveAssets: deps.hideInactiveAssets(),
      calibrationContext: deps.calibrationContext(),
      playerCounts: PLAYER_COUNTS,
      tablePositions: TABLE_POSITIONS,
      archetypeNames: ARCHETYPE_NAMES,
      profiles: profilePlayerIds().map((playerId) => ({
        playerId,
        label: playerId === "hero" ? `Hero (${tableConfig.heroPosition})` : positionDisplayName(positionFromPageKey(playerId)),
        profile: deps.playerProfiles()[playerId]?.archetypes || {},
      })),
    });
    bindConfigControls({
      documentRef: deps.documentRef,
      handlers: {
        changePlayerCount,
        changeHeroPosition,
        changePlayerStack,
        toggleHideInactiveAssets: deps.toggleHideInactiveAssets,
        changeCalibrationStakeBucket,
        changeCalibrationYearBucket,
        changePlayerArchetypeWeight,
      },
    });
  }

  function profilePlayerIds() {
    return ["hero", ...deps.villainPageKeys()];
  }

  function changePlayerCount(event) {
    const tableConfig = deps.tableConfig();
    deps.updateTableConfig({
      ...tableConfig,
      playerCount: Number(event.target.value),
      heroPosition: tableConfig.heroPosition,
    });
  }

  function changeHeroPosition(event) {
    const tableConfig = deps.tableConfig();
    deps.updateTableConfig({
      ...tableConfig,
      playerCount: tableConfig.playerCount,
      heroPosition: event.target.value,
    });
  }

  function changePlayerStack(event) {
    const tableConfig = deps.tableConfig();
    deps.updateTableConfig({
      ...tableConfig,
      playerStacks: {
        ...(tableConfig.playerStacks || {}),
        [event.target.dataset.stackPosition]: Number(event.target.value),
      },
    });
  }

  function changeCalibrationStakeBucket(event) {
    deps.updateCalibrationContext({ ...deps.calibrationContext(), stakeBucket: event.target.value });
  }

  function changeCalibrationYearBucket(event) {
    deps.updateCalibrationContext({ ...deps.calibrationContext(), yearBucket: event.target.value });
  }

  function changePlayerArchetypeWeight(event) {
    const playerId = event.target.dataset.archetypePlayer;
    const name = event.target.dataset.archetypeName;
    if (!playerId || !name) {
      return;
    }
    const value = Number(event.target.value) / 100;
    const nextProfiles = {
      ...deps.playerProfiles(),
      [playerId]: {
        ...(deps.playerProfiles()[playerId] || {}),
        archetypes: {
          ...(deps.playerProfiles()[playerId]?.archetypes || {}),
          [name]: value,
        },
      },
    };
    const output = event.target.closest("label")?.querySelector("output");
    if (output) {
      output.textContent = `${Math.round(value * 100)}%`;
    }
    deps.updatePlayerProfiles(nextProfiles);
    if (event.type === "change" || deps.activePage() !== "config") {
      deps.renderAssets();
    }
  }

  return {
    renderConfigPage,
    changePlayerCount,
    changeHeroPosition,
    changePlayerStack,
    changeCalibrationStakeBucket,
    changeCalibrationYearBucket,
    changePlayerArchetypeWeight,
  };
}
