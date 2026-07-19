export const LOCAL_STORAGE_SCHEMA_VERSION = 1;

export const LOCAL_STORAGE_KEYS = Object.freeze({
  schemaVersion: "essence-storage-schema-version",
  theme: "essence-theme",
  hideInactiveAssets: "essence-hide-inactive-assets",
  playerCount: "essence-player-count",
  heroPosition: "essence-hero-position",
  playerStacks: "essence-player-stacks",
  calibrationContext: "essence-calibration-context",
  playerProfiles: "essence-player-profiles",
  legacyFoldedVillains: "essence-folded-villains",
});

const DEFAULT_CALIBRATION_CONTEXT = Object.freeze({
  stakeBucket: "micro",
  yearBucket: "2009-2010",
});

export function readPersistedUiState(storage = globalThis.localStorage) {
  migrateLocalStorage(storage);
  const calibrationContext = parseObject(safeGet(storage, LOCAL_STORAGE_KEYS.calibrationContext));
  return {
    useDarkTheme: safeGet(storage, LOCAL_STORAGE_KEYS.theme) === "dark",
    hideInactiveAssets: safeGet(storage, LOCAL_STORAGE_KEYS.hideInactiveAssets) === "true",
    tableConfig: {
      playerCount: parsePlayerCount(safeGet(storage, LOCAL_STORAGE_KEYS.playerCount)),
      heroPosition: safeGet(storage, LOCAL_STORAGE_KEYS.heroPosition),
      playerStacks: parsePlayerStacks(safeGet(storage, LOCAL_STORAGE_KEYS.playerStacks)),
    },
    calibrationContext: {
      stakeBucket: stringOrDefault(calibrationContext.stakeBucket, DEFAULT_CALIBRATION_CONTEXT.stakeBucket),
      yearBucket: stringOrDefault(calibrationContext.yearBucket, DEFAULT_CALIBRATION_CONTEXT.yearBucket),
    },
    playerProfiles: parseObject(safeGet(storage, LOCAL_STORAGE_KEYS.playerProfiles)),
  };
}

export function migrateLocalStorage(storage = globalThis.localStorage) {
  if (!storage) {
    return;
  }
  const rawVersion = safeGet(storage, LOCAL_STORAGE_KEYS.schemaVersion);
  const version = Number(rawVersion || 0);
  if (!Number.isFinite(version) || version < 1) {
    safeRemove(storage, LOCAL_STORAGE_KEYS.legacyFoldedVillains);
    safeSet(storage, LOCAL_STORAGE_KEYS.schemaVersion, String(LOCAL_STORAGE_SCHEMA_VERSION));
    return;
  }
  if (version < LOCAL_STORAGE_SCHEMA_VERSION) {
    safeSet(storage, LOCAL_STORAGE_KEYS.schemaVersion, String(LOCAL_STORAGE_SCHEMA_VERSION));
  }
}

export function persistTheme(storage, useDarkTheme) {
  safeSetCurrentVersion(storage);
  safeSet(storage, LOCAL_STORAGE_KEYS.theme, useDarkTheme ? "dark" : "light");
}

export function persistHideInactiveAssets(storage, hideInactiveAssets) {
  safeSetCurrentVersion(storage);
  safeSet(storage, LOCAL_STORAGE_KEYS.hideInactiveAssets, hideInactiveAssets ? "true" : "false");
}

export function persistTableConfig(storage, tableConfig) {
  safeSetCurrentVersion(storage);
  safeSet(storage, LOCAL_STORAGE_KEYS.playerCount, String(tableConfig.playerCount));
  safeSet(storage, LOCAL_STORAGE_KEYS.heroPosition, tableConfig.heroPosition || "");
  safeRemove(storage, LOCAL_STORAGE_KEYS.legacyFoldedVillains);
  safeSet(storage, LOCAL_STORAGE_KEYS.playerStacks, JSON.stringify(tableConfig.playerStacks || {}));
}

export function persistCalibrationContext(storage, calibrationContext) {
  safeSetCurrentVersion(storage);
  safeSet(storage, LOCAL_STORAGE_KEYS.calibrationContext, JSON.stringify({
    stakeBucket: stringOrDefault(calibrationContext?.stakeBucket, DEFAULT_CALIBRATION_CONTEXT.stakeBucket),
    yearBucket: stringOrDefault(calibrationContext?.yearBucket, DEFAULT_CALIBRATION_CONTEXT.yearBucket),
  }));
}

export function persistPlayerProfiles(storage, playerProfiles) {
  safeSetCurrentVersion(storage);
  safeSet(storage, LOCAL_STORAGE_KEYS.playerProfiles, JSON.stringify(playerProfiles || {}));
}

function safeSetCurrentVersion(storage) {
  safeSet(storage, LOCAL_STORAGE_KEYS.schemaVersion, String(LOCAL_STORAGE_SCHEMA_VERSION));
}

function parsePlayerCount(rawValue) {
  const count = Number(rawValue || 2);
  return Number.isInteger(count) && count >= 2 && count <= 6 ? count : 2;
}

function parsePlayerStacks(rawValue) {
  const parsed = parseObject(rawValue);
  const entries = [];
  for (const [position, stack] of Object.entries(parsed)) {
    const numericStack = Number(stack);
    if (Number.isFinite(numericStack) && numericStack >= 0) {
      entries.push([position, numericStack]);
    }
  }
  return Object.fromEntries(entries);
}

function parseObject(rawValue) {
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

function stringOrDefault(value, fallback) {
  return typeof value === "string" && value ? value : fallback;
}

function safeGet(storage, key) {
  try {
    return storage?.getItem?.(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(storage, key, value) {
  try {
    storage?.setItem?.(key, value);
  } catch {
    // Browser privacy modes can reject writes; persisted UI state is optional.
  }
}

function safeRemove(storage, key) {
  try {
    storage?.removeItem?.(key);
  } catch {
    // Browser privacy modes can reject writes; persisted UI state is optional.
  }
}
