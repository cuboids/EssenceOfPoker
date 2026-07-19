import { handViewFromModel } from "./hand_view.mjs";
import { ACTION_STREETS, actionsVisibleThroughStreet } from "./player_actions.mjs";
import {
  cloneCacheObject,
  cloneHandModel,
  clonePlayerActions,
  cloneShowdownHoleCardsByPlayer,
} from "./street_snapshots.mjs";
import * as HandModel from "./hand_state.mjs";

/**
 * @typedef {{streetIndex: number, actionCount: number}} ActionMoment
 * @typedef {{handModel?: object | null, currentCurves?: object, currentWinShares?: object, playerActions?: object[], showdownHoleCardsByPlayer?: object}} StreetSnapshot
 * @typedef {{currentCurves?: object, currentWinShares?: object}} ActionMomentCacheEntry
 * @typedef {{handModel?: object | null, handTimeline?: StreetSnapshot[], viewedStreetIndex?: number, viewedActionCount?: number | null, playerActions?: object[], currentCurves?: object, currentWinShares?: object, showdownHoleCardsByPlayer?: object}} VisibleSnapshotOptions
 * @typedef {{handTimeline?: StreetSnapshot[], moment: ActionMoment, playerActions?: object[], actionMomentCache?: Map<string, ActionMomentCacheEntry>, fallbackCurves?: object, fallbackWinShares?: object}} VisibleMomentOptions
 */

export function actionStreetForHandModel(model) {
  return model?.phase === HandModel.HAND_PHASES.SHOWDOWN ? HandModel.HAND_PHASES.RIVER : model?.phase;
}

export function actionCountBeforeStreet(actions = [], street) {
  const streetIndex = ACTION_STREETS.indexOf(street);
  if (streetIndex <= 0) {
    return 0;
  }
  return actions.filter((action) => ACTION_STREETS.indexOf(action.street) < streetIndex).length;
}

export function actionCountThroughStreet(actions = [], street) {
  return actionsVisibleThroughStreet(actions, street).length;
}

export function actionCountsForStreet(actions = [], street) {
  const counts = new Set([actionCountBeforeStreet(actions, street)]);
  actions.forEach((action, index) => {
    if (action.street === street) {
      counts.add(index + 1);
    }
  });
  return [...counts].sort((first, second) => first - second);
}

export function navigationMomentsForTimeline(timeline = [], actions = []) {
  return timeline.flatMap((snapshot, streetIndex) => {
    const street = actionStreetForHandModel(snapshot.handModel);
    if (!street) {
      return [];
    }
    return actionCountsForStreet(actions, street).map((actionCount) => ({ streetIndex, actionCount }));
  });
}

export function currentViewedActionCount({ handState, viewedActionCount, playerActions }) {
  if (!handState) {
    return null;
  }
  return viewedActionCount == null
    ? actionCountThroughStreet(playerActions, handState.round)
    : viewedActionCount;
}

export function actionMomentCacheKey(moment) {
  return `${moment.streetIndex}:${moment.actionCount}`;
}

export function visibleActionsForStreet({ handState, viewedActionCount, playerActions }, street = handState?.round || null) {
  if (!street) {
    return [];
  }
  const visibleCount = currentViewedActionCount({ handState, viewedActionCount, playerActions });
  const actionPrefix = visibleCount == null ? playerActions : playerActions.slice(0, visibleCount);
  return actionsVisibleThroughStreet(actionPrefix, street);
}

/**
 * @param {VisibleSnapshotOptions} [options]
 */
export function resolveVisibleHandSnapshot({
  handModel,
  handTimeline = [],
  viewedStreetIndex = -1,
  viewedActionCount = null,
  playerActions = [],
  currentCurves = {},
  currentWinShares = {},
  showdownHoleCardsByPlayer = {},
} = {}) {
  const view = handViewFromModel(handModel);
  const moment = view && viewedStreetIndex >= 0
    ? { streetIndex: viewedStreetIndex, actionCount: currentViewedActionCount({ handState: view, viewedActionCount, playerActions }) }
    : null;
  const moments = navigationMomentsForTimeline(handTimeline, playerActions);
  const momentIndex = moment
    ? moments.findIndex((candidate) =>
      candidate.streetIndex === moment.streetIndex && candidate.actionCount === moment.actionCount,
    )
    : -1;
  const visibleActions = visibleActionsForStreet({ handState: view, viewedActionCount, playerActions });
  return {
    handModel: cloneHandModel(handModel),
    handState: view,
    villainShowdown: HandModel.isShowdown(handModel),
    handTimeline: cloneTimeline(handTimeline),
    playerActions: clonePlayerActions(playerActions),
    viewedStreetIndex,
    viewedActionCount: moment?.actionCount ?? null,
    currentActionStreet: view?.round || null,
    currentActionPrefix: moment?.actionCount == null ? clonePlayerActions(playerActions) : clonePlayerActions(playerActions.slice(0, moment.actionCount)),
    visiblePlayerActions: clonePlayerActions(visibleActions),
    navigationMoments: moments,
    currentNavigationMomentIndex: momentIndex,
    isViewingLatestMoment: momentIndex >= 0 && momentIndex === moments.length - 1,
    currentCurves: cloneCacheObject(currentCurves),
    currentWinShares: cloneCacheObject(currentWinShares),
    showdownHoleCardsByPlayer: cloneShowdownHoleCardsByPlayer(showdownHoleCardsByPlayer),
    momentKey: moment ? actionMomentCacheKey(moment) : null,
  };
}

/**
 * @param {VisibleMomentOptions} options
 */
export function visibleHandSnapshotForMoment({
  handTimeline = [],
  moment,
  playerActions = [],
  actionMomentCache = new Map(),
  fallbackCurves = {},
  fallbackWinShares = {},
}) {
  const streetSnapshot = handTimeline[moment.streetIndex];
  if (!streetSnapshot) {
    throw new Error(`no hand snapshot exists for street index ${moment.streetIndex}`);
  }
  const cached = actionMomentCache.get(actionMomentCacheKey(moment));
  const handModel = cloneHandModel(streetSnapshot.handModel);
  const canonicalActions = clonePlayerActions(streetSnapshot.playerActions || playerActions);
  return resolveVisibleHandSnapshot({
    handModel,
    handTimeline,
    viewedStreetIndex: moment.streetIndex,
    viewedActionCount: moment.actionCount,
    playerActions: canonicalActions,
    currentCurves: cached?.currentCurves || fallbackCurves,
    currentWinShares: cached?.currentWinShares || fallbackWinShares,
    showdownHoleCardsByPlayer: streetSnapshot.showdownHoleCardsByPlayer || {},
  });
}

export function cacheVisibleHandSnapshot(actionMomentCache, snapshot) {
  if (!snapshot?.handState || snapshot.viewedStreetIndex < 0 || !snapshot.momentKey) {
    return actionMomentCache;
  }
  const nextCache = new Map(actionMomentCache);
  nextCache.set(snapshot.momentKey, {
    currentCurves: cloneCacheObject(snapshot.currentCurves),
    currentWinShares: cloneCacheObject(snapshot.currentWinShares),
  });
  return nextCache;
}

function cloneTimeline(timeline = []) {
  return timeline.map((snapshot) => ({
    handModel: cloneHandModel(snapshot.handModel),
    currentCurves: cloneCacheObject(snapshot.currentCurves || {}),
    currentWinShares: cloneCacheObject(snapshot.currentWinShares || {}),
    playerActions: clonePlayerActions(snapshot.playerActions || []),
    showdownHoleCardsByPlayer: cloneShowdownHoleCardsByPlayer(snapshot.showdownHoleCardsByPlayer || {}),
  }));
}
