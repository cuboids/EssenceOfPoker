export function cloneHandModel(model) {
  return {
    ...model,
    hole: [...model.hole],
    villain: [...model.villain],
    flop: [...model.flop],
    suitMap: new Map(model.suitMap),
  };
}

export function cloneCacheObject(cache) {
  return { ...cache };
}

export function streetIndexForRound(round) {
  return {
    preflop: 0,
    flop: 1,
    turn: 2,
    river: 3,
  }[round] ?? -1;
}

export function emptyStreetSnapshot(handModel) {
  return {
    handModel: cloneHandModel(handModel),
    currentCurves: {},
    currentWinShares: {},
    playerActions: [],
    showdownHoleCardsByPlayer: {},
  };
}

export function recordStreetSnapshot(handTimeline, handModel, round, playerActions = [], showdownHoleCardsByPlayer = {}) {
  const viewedStreetIndex = streetIndexForRound(round);
  const nextTimeline = handTimeline.slice(0, viewedStreetIndex);
  nextTimeline[viewedStreetIndex] = {
    ...emptyStreetSnapshot(handModel),
    playerActions: clonePlayerActions(playerActions),
    showdownHoleCardsByPlayer: cloneShowdownHoleCardsByPlayer(showdownHoleCardsByPlayer),
  };
  return { handTimeline: nextTimeline, viewedStreetIndex };
}

export function updateStreetSnapshot(
  handTimeline,
  viewedStreetIndex,
  handModel,
  currentCurves,
  currentWinShares,
  playerActions = [],
  showdownHoleCardsByPlayer = {},
) {
  if (viewedStreetIndex < 0) {
    return handTimeline;
  }
  const nextTimeline = [...handTimeline];
  nextTimeline[viewedStreetIndex] = {
    handModel: cloneHandModel(handModel),
    currentCurves: cloneCacheObject(currentCurves),
    currentWinShares: cloneCacheObject(currentWinShares),
    playerActions: clonePlayerActions(playerActions),
    showdownHoleCardsByPlayer: cloneShowdownHoleCardsByPlayer(showdownHoleCardsByPlayer),
  };
  return nextTimeline;
}

export function clonePlayerActions(actions = []) {
  return actions.map((action) => ({ ...action }));
}

export function cloneShowdownHoleCardsByPlayer(cardsByPlayer = {}) {
  return Object.fromEntries(
    Object.entries(cardsByPlayer).map(([player, cards]) => [player, cards.map((card) => ({ ...card }))]),
  );
}
