import { preflopClassKeyForCards } from "../cache_keys.mjs";
import {
  validatePreflopAggregateClassPayload,
  validatePreflopHiddenVillainClassPayload,
  validatePreflopPrimaryClassPayload,
} from "../data_contracts.mjs";

/**
 * @typedef {{ ok: boolean, value?: any, reason?: string, error?: unknown }} DataResult
 */

/**
 * @param {{
 *   aggregateClasses?: Record<string, any>,
 *   hiddenVillainClasses?: Record<string, any>,
 *   primaryClasses?: Record<string, any>,
 *   getBucketCount?: () => number,
 *   readAggregateClassResult?: (classKey: string) => Promise<DataResult>,
 *   readHiddenVillainClassResult?: (classKey: string) => Promise<DataResult>,
 *   readPrimaryClassResult?: (classKey: string) => Promise<DataResult>,
 *   onPartLoaded?: (classKey: string) => void,
 * }} [options]
 */
export function createPreflopClassStore({
  aggregateClasses = {},
  hiddenVillainClasses = {},
  primaryClasses = {},
  getBucketCount = () => 0,
  readAggregateClassResult = async () => ({ ok: false, reason: "unavailable" }),
  readHiddenVillainClassResult = async () => ({ ok: false, reason: "unavailable" }),
  readPrimaryClassResult = async () => ({ ok: false, reason: "unavailable" }),
  onPartLoaded = () => {},
} = {}) {
  let loadKey = "";
  let loadPromise = null;
  const unavailableClassKeys = new Set();

  function ready(h1, h2) {
    const classKey = preflopClassKeyForCards(h1, h2);
    return Boolean(aggregateClasses[classKey] && hiddenVillainClasses[classKey] && primaryClasses[classKey]);
  }

  function unavailable(h1, h2) {
    return unavailableClassKeys.has(preflopClassKeyForCards(h1, h2));
  }

  async function preloadHiddenVillainClass(h1, h2) {
    const classKey = preflopClassKeyForCards(h1, h2);
    if (hiddenVillainClasses[classKey]) {
      return true;
    }
    const result = await readHiddenVillainClassResult(classKey);
    const payload = result.ok ? result.value : null;
    if (payload?.curves) {
      hiddenVillainClasses[classKey] = validatePreflopHiddenVillainClassPayload(payload, {
        bucketCount: getBucketCount(),
        strictCounts: true,
      }).curves;
      onPartLoaded(classKey);
      return true;
    }
    return false;
  }

  async function preloadAggregateClass(h1, h2) {
    const classKey = preflopClassKeyForCards(h1, h2);
    if (aggregateClasses[classKey]) {
      return true;
    }
    const result = await readAggregateClassResult(classKey);
    const payload = result.ok ? result.value : null;
    if (payload?.aggregates) {
      const validated = validatePreflopAggregateClassPayload(payload, {
        bucketCount: getBucketCount(),
        strictCounts: true,
      });
      aggregateClasses[classKey] = {
        source: validated.source,
        exact: validated.exact,
        totalCombos: validated.totalCombos,
        bucketCount: validated.bucketCount,
        classes: {
          [classKey]: validated.aggregates,
        },
      };
      onPartLoaded(classKey);
      return true;
    }
    return false;
  }

  async function preloadPrimaryClass(h1, h2) {
    const classKey = preflopClassKeyForCards(h1, h2);
    if (primaryClasses[classKey]) {
      return true;
    }
    const result = await readPrimaryClassResult(classKey);
    const payload = result.ok ? result.value : null;
    if (payload?.assets) {
      primaryClasses[classKey] = validatePreflopPrimaryClassPayload(payload, {
        bucketCount: getBucketCount(),
        strictCounts: true,
      }).assets;
      onPartLoaded(classKey);
      return true;
    }
    return false;
  }

  async function preload(h1, h2) {
    const [hiddenLoaded, aggregateLoaded, primaryLoaded] = await Promise.all([
      preloadHiddenVillainClass(h1, h2),
      preloadAggregateClass(h1, h2),
      preloadPrimaryClass(h1, h2),
    ]);
    return hiddenLoaded && aggregateLoaded && primaryLoaded;
  }

  /**
   * @param {any} h1
   * @param {any} h2
   * @param {{ onLoaded?: (result: { classKey: string, loaded: boolean }) => void }} [options]
   */
  function queueLoad(h1, h2, { onLoaded = () => {} } = {}) {
    if (!h1 || !h2 || ready(h1, h2)) {
      return Promise.resolve();
    }
    const classKey = preflopClassKeyForCards(h1, h2);
    if (loadKey === classKey && loadPromise) {
      return loadPromise;
    }

    loadKey = classKey;
    loadPromise = preload(h1, h2).then((loaded) => {
      if (!loaded) {
        unavailableClassKeys.add(classKey);
      } else {
        unavailableClassKeys.delete(classKey);
      }
      onLoaded({ classKey, loaded });
    }).finally(() => {
      if (loadKey === classKey) {
        loadKey = "";
        loadPromise = null;
      }
    });
    return loadPromise;
  }

  return {
    aggregateClasses,
    hiddenVillainClasses,
    primaryClasses,
    ready,
    unavailable,
    queueLoad,
  };
}
