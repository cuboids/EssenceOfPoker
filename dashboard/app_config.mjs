export const smallChart = Object.freeze({
  width: 360,
  height: 78,
  padding: Object.freeze({ top: 8, right: 8, bottom: 14, left: 8 }),
});

export const largeChart = Object.freeze({
  width: 1120,
  height: 430,
  padding: Object.freeze({ top: 22, right: 28, bottom: 42, left: 58 }),
});

export const POSITION_TOKENS = Object.freeze({
  H_1: "h1",
  H_2: "h2",
  V_1: "v1",
  V_2: "v2",
  F_1: "f1",
  F_2: "f2",
  F_3: "f3",
  T: "turn",
  R: "river",
});

export const categoryLabels = Object.freeze({
  AGGREGATE: "Aggregates",
  CARD_1_PLUS_CARD_2: "Both hole cards",
  CARD_1: "First hole card",
  CARD_2: "Second hole card",
  ZERO: "Only community cards",
});

export const categoryDescriptions = Object.freeze({
  AGGREGATE: "Same-world minimums across asset groups",
  CARD_1_PLUS_CARD_2: "H<sub>1</sub>H<sub>2</sub> + 3 community cards",
  CARD_1: "H<sub>1</sub> + 4 community cards",
  CARD_2: "H<sub>2</sub> + 4 community cards",
  ZERO: "0 hole cards + 5 community cards",
});

export const categoryOrder = Object.freeze(["AGGREGATE", "CARD_1_PLUS_CARD_2", "CARD_1", "CARD_2", "ZERO"]);
