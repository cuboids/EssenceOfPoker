import { TABLE_POSITIONS } from "./table_positions.mjs";

const STREET_ORDER = Object.freeze(["preflop", "flop", "turn", "river"]);
const AGGRESSIVE_ACTIONS = new Set(["bet", "raise", "all-in"]);

export function chooseInterestingHero(players = [], actions = []) {
  const candidates = players.filter((player) =>
    TABLE_POSITIONS.includes(player.position) && (player.hole_cards || []).length === 2,
  );
  if (!candidates.length) {
    return players.find((player) => TABLE_POSITIONS.includes(player.position)) || players[0] || null;
  }

  const latestStreet = latestActionStreet(actions);
  const scores = candidates.map((player, index) => ({
    player,
    index,
    score: heroCandidateScore(player, actions, latestStreet),
  }));

  scores.sort((first, second) =>
    second.score - first.score ||
    Number(Boolean(second.player.is_hero)) - Number(Boolean(first.player.is_hero)) ||
    Number(second.player.position === "BB") - Number(first.player.position === "BB") ||
    first.index - second.index,
  );
  return scores[0].player;
}

function heroCandidateScore(player, actions, latestStreet) {
  const playerActions = actions.filter((action) => action.player_id === player.source_player_id);
  const folded = playerActions.some((action) => action.action_type === "fold");
  const foldedPreflop = playerActions.some((action) => action.street === "preflop" && action.action_type === "fold");
  const latestStreetActions = latestStreet
    ? playerActions.filter((action) => action.street === latestStreet).length
    : 0;
  const latestStreetAggression = latestStreet
    ? playerActions.filter((action) => action.street === latestStreet && AGGRESSIVE_ACTIONS.has(action.action_type)).length
    : 0;
  const aggressiveActions = playerActions.filter((action) => AGGRESSIVE_ACTIONS.has(action.action_type)).length;
  const calls = playerActions.filter((action) => action.action_type === "call").length;

  return (
    (folded ? 0 : 10_000) +
    (foldedPreflop ? 0 : 1_000) +
    (latestStreetActions ? 500 : 0) +
    latestStreetAggression * 200 +
    playerActions.length * 10 +
    aggressiveActions * 6 +
    calls * 3
  );
}

function latestActionStreet(actions) {
  return actions.reduce((latest, action) => {
    const actionIndex = STREET_ORDER.indexOf(action.street);
    const latestIndex = STREET_ORDER.indexOf(latest);
    return actionIndex > latestIndex ? action.street : latest;
  }, "preflop");
}
