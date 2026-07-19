import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import zlib from "node:zlib";

import { createPreflopClassStore } from "../dashboard/stores/preflop_class_store.mjs";

const card = (rank, suit) => ({ rank, suit, id: (rank - 1) * 4 + (suit - 1) });

test("preflop class store loads and validates all class payload families", async () => {
  const aggregatePayload = readJsonOrGzip("../essence_of_poker/data/preflop_aggregate_classes/1-1-pair.json");
  const hiddenPayload = readJsonOrGzip("../essence_of_poker/data/preflop_hidden_villain_classes/1-1-pair.json");
  const primaryPayload = readJsonOrGzip("../essence_of_poker/data/preflop_primary_classes/1-1-pair.json");
  const loadedParts = [];
  const store = createPreflopClassStore({
    getBucketCount: () => 7462,
    readAggregateClass: async () => aggregatePayload,
    readHiddenVillainClass: async () => hiddenPayload,
    readPrimaryClass: async () => primaryPayload,
    onPartLoaded: (classKey) => loadedParts.push(classKey),
  });

  assert.equal(store.ready(card(1, 1), card(1, 2)), false);
  await store.queueLoad(card(1, 1), card(1, 2));

  assert.equal(store.ready(card(1, 1), card(1, 2)), true);
  assert.equal(store.unavailable(card(1, 1), card(1, 2)), false);
  assert.equal(store.aggregateClasses["1-1-pair"].totalCombos, aggregatePayload.totalCombos);
  assert.equal(store.hiddenVillainClasses["1-1-pair"].shared.totalCombos, hiddenPayload.curves.shared.totalCombos);
  assert.equal(Object.keys(store.primaryClasses["1-1-pair"]).length, 21);
  assert.deepEqual(loadedParts, ["1-1-pair", "1-1-pair", "1-1-pair"]);
});

test("preflop class store marks unavailable classes after missing payloads", async () => {
  const store = createPreflopClassStore({
    getBucketCount: () => 7462,
    readAggregateClass: async () => null,
    readHiddenVillainClass: async () => null,
    readPrimaryClass: async () => null,
  });

  await store.queueLoad(card(2, 1), card(5, 1));

  assert.equal(store.ready(card(2, 1), card(5, 1)), false);
  assert.equal(store.unavailable(card(2, 1), card(5, 1)), true);
});

function readJsonOrGzip(relativePath) {
  const jsonUrl = new URL(relativePath, import.meta.url);
  if (fs.existsSync(jsonUrl)) {
    return JSON.parse(fs.readFileSync(jsonUrl, "utf8"));
  }
  const compressed = fs.readFileSync(new URL(`${relativePath}.gz`, import.meta.url));
  return JSON.parse(zlib.gunzipSync(compressed).toString("utf8"));
}
