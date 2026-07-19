import { preflopClassKeyForCards } from "../cache_keys.mjs";
import {
  validatePreflopAggregateClassPayload,
  validatePreflopHiddenVillainClassPayload,
  validatePreflopPrimaryClassPayload,
} from "../data_contracts.mjs";

export function createPreflopClassStore({
  aggregateClasses = {},
  hiddenVillainClasses = {},
  primaryClasses = {},
  getBucketCount,
  readAggregateClass,
  readHiddenVillainClass,
  readPrimaryClass,
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
    const payload = await readHiddenVillainClass(classKey);
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
    const payload = await readAggregateClass(classKey);
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
    const payload = await readPrimaryClass(classKey);
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
