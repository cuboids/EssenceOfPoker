export function createSeededRng(seed = 1) {
  let state = seed >>> 0;
  return {
    seed: state,
    next() {
      state += 0x6D2B79F5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    },
    integer(maxExclusive) {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new Error("RNG integer bound must be a positive integer");
      }
      return Math.floor(this.next() * maxExclusive);
    },
  };
}

export function sessionSeed({ now = Date.now, cryptoRef = globalThis.crypto } = {}) {
  const values = new Uint32Array(1);
  try {
    cryptoRef?.getRandomValues?.(values);
  } catch {
    values[0] = 0;
  }
  return (values[0] ^ hashString(`${now()}:${globalThis.location?.href || ""}`)) >>> 0;
}

export function drawCardsFromDeck(deck, count, rng) {
  const remaining = [...deck];
  const cards = [];
  for (let cardIndex = 0; cardIndex < count; cardIndex += 1) {
    if (!remaining.length) {
      throw new Error("Cannot draw more cards than remain in the deck");
    }
    const deckIndex = rng.integer(remaining.length);
    cards.push(remaining.splice(deckIndex, 1)[0]);
  }
  return cards;
}

export function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
