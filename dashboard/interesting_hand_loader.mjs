import { readRandomInterestingHand } from "./data_client.mjs";
import {
  interestingHandToAppState,
  modelFromImportedHandReplay,
} from "./imported_hand_replay.mjs";

/**
 * @param {{
 *   readHand?: () => Promise<any>,
 *   dealers: {
 *     dealHoleCards: () => any[],
 *     dealCardsFromDeck: (deck: any[], count: number) => any[],
 *     remainingDeckForKnownCards: (cards: any[]) => any[],
 *   },
 * }} options
 */
export async function loadRandomInterestingHandResult({
  readHand = readRandomInterestingHand,
  dealers,
}) {
  try {
    const payload = await readHand();
    if (!payload?.hand) {
      return {
        ok: /** @type {const} */ (false),
        message: payload?.error || "No dashboard-compatible interesting hand is available.",
        payload,
      };
    }
    const imported = interestingHandToAppState(payload.hand);
    const handModel = modelFromImportedHandReplay(imported, dealers);
    return { ok: /** @type {const} */ (true), payload, imported, handModel };
  } catch (error) {
    return {
      ok: /** @type {const} */ (false),
      message: `Could not load interesting hand${error?.message ? `: ${error.message}` : "."}`,
      error,
    };
  }
}
