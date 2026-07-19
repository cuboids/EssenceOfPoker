import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCAL_STORAGE_KEYS,
  LOCAL_STORAGE_SCHEMA_VERSION,
  persistCalibrationContext,
  persistHideInactiveAssets,
  persistPlayerProfiles,
  persistTableConfig,
  persistTheme,
  readPersistedUiState,
} from "../dashboard/local_storage_schema.mjs";

test("local storage migration versions legacy state and removes stale folded villains", () => {
  const storage = fakeStorage([
    [LOCAL_STORAGE_KEYS.theme, "dark"],
    [LOCAL_STORAGE_KEYS.hideInactiveAssets, "true"],
    [LOCAL_STORAGE_KEYS.playerCount, "6"],
    [LOCAL_STORAGE_KEYS.heroPosition, "BTN"],
    [LOCAL_STORAGE_KEYS.playerStacks, "{\"SB\":40,\"BB\":120,\"BAD\":\"nan\",\"NEG\":-1}"],
    [LOCAL_STORAGE_KEYS.calibrationContext, "{\"stakeBucket\":\"small\",\"yearBucket\":\"2019+\"}"],
    [LOCAL_STORAGE_KEYS.playerProfiles, "{\"BTN\":{\"archetypes\":{\"TAG\":0.7}}}"],
    [LOCAL_STORAGE_KEYS.legacyFoldedVillains, "[\"BB\"]"],
  ]);

  const persisted = readPersistedUiState(storage);

  assert.equal(storage.getItem(LOCAL_STORAGE_KEYS.schemaVersion), String(LOCAL_STORAGE_SCHEMA_VERSION));
  assert.equal(storage.getItem(LOCAL_STORAGE_KEYS.legacyFoldedVillains), null);
  assert.equal(persisted.useDarkTheme, true);
  assert.equal(persisted.hideInactiveAssets, true);
  assert.deepEqual(persisted.tableConfig, {
    playerCount: 6,
    heroPosition: "BTN",
    playerStacks: { SB: 40, BB: 120 },
  });
  assert.deepEqual(persisted.calibrationContext, {
    stakeBucket: "small",
    yearBucket: "2019+",
  });
  assert.deepEqual(persisted.playerProfiles, {
    BTN: { archetypes: { TAG: 0.7 } },
  });
});

test("local storage reader normalizes malformed and unavailable state", () => {
  const storage = fakeStorage([
    [LOCAL_STORAGE_KEYS.playerCount, "42"],
    [LOCAL_STORAGE_KEYS.playerStacks, "not-json"],
    [LOCAL_STORAGE_KEYS.calibrationContext, "{\"stakeBucket\":\"\"}"],
    [LOCAL_STORAGE_KEYS.playerProfiles, "[]"],
  ]);

  assert.deepEqual(readPersistedUiState(storage), {
    useDarkTheme: false,
    hideInactiveAssets: false,
    tableConfig: {
      playerCount: 2,
      heroPosition: null,
      playerStacks: {},
    },
    calibrationContext: {
      stakeBucket: "micro",
      yearBucket: "2009-2010",
    },
    playerProfiles: {},
  });

  assert.deepEqual(readPersistedUiState(null).tableConfig, {
    playerCount: 2,
    heroPosition: null,
    playerStacks: {},
  });

  const readOnlyStorage = { getItem: () => null };
  assert.equal(readPersistedUiState(readOnlyStorage).useDarkTheme, false);
});

test("local storage persist helpers write current schema payloads", () => {
  const storage = fakeStorage();

  persistTheme(storage, true);
  persistHideInactiveAssets(storage, true);
  persistTableConfig(storage, {
    playerCount: 5,
    heroPosition: "CO",
    playerStacks: { CO: 200, BB: 100 },
  });
  persistCalibrationContext(storage, { stakeBucket: "high", yearBucket: "2014-2018" });
  persistPlayerProfiles(storage, { CO: { archetypes: { LAG: 0.4 } } });

  assert.equal(storage.getItem(LOCAL_STORAGE_KEYS.schemaVersion), String(LOCAL_STORAGE_SCHEMA_VERSION));
  assert.equal(storage.getItem(LOCAL_STORAGE_KEYS.theme), "dark");
  assert.equal(storage.getItem(LOCAL_STORAGE_KEYS.hideInactiveAssets), "true");
  assert.equal(storage.getItem(LOCAL_STORAGE_KEYS.playerCount), "5");
  assert.equal(storage.getItem(LOCAL_STORAGE_KEYS.heroPosition), "CO");
  assert.equal(storage.getItem(LOCAL_STORAGE_KEYS.playerStacks), "{\"CO\":200,\"BB\":100}");
  assert.equal(storage.getItem(LOCAL_STORAGE_KEYS.calibrationContext), "{\"stakeBucket\":\"high\",\"yearBucket\":\"2014-2018\"}");
  assert.equal(storage.getItem(LOCAL_STORAGE_KEYS.playerProfiles), "{\"CO\":{\"archetypes\":{\"LAG\":0.4}}}");
});

function fakeStorage(entries = []) {
  const values = new Map(entries);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}
