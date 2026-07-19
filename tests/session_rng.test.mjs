import assert from "node:assert/strict";
import test from "node:test";

import {
  createSeededRng,
  drawCardsFromDeck,
  hashString,
  sessionSeed,
} from "../dashboard/session_rng.mjs";

test("seeded RNG produces reproducible streams and bounded integers", () => {
  const first = createSeededRng(123);
  const second = createSeededRng(123);

  assert.deepEqual(
    [first.next(), first.next(), first.integer(10), first.integer(10)],
    [second.next(), second.next(), second.integer(10), second.integer(10)],
  );
  assert.throws(() => first.integer(0), /positive integer/);
});

test("seeded deck draws are reproducible and without replacement", () => {
  const deck = Array.from({ length: 10 }, (_, index) => ({ id: index }));
  const first = drawCardsFromDeck(deck, 5, createSeededRng(99));
  const second = drawCardsFromDeck(deck, 5, createSeededRng(99));

  assert.deepEqual(first, second);
  assert.equal(new Set(first.map((card) => card.id)).size, 5);
  assert.throws(() => drawCardsFromDeck(deck, 11, createSeededRng(1)), /more cards/);
});

test("session seeds mix clock/location entropy with browser crypto when available", () => {
  const cryptoRef = { getRandomValues: (values) => { values[0] = 1234; } };
  const seed = sessionSeed({ now: () => 5678, cryptoRef });

  assert.equal(seed, (1234 ^ hashString("5678:")) >>> 0);
  assert.equal(sessionSeed({ now: () => 5678, cryptoRef: null }), hashString("5678:"));
});
