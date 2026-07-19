export function validateWinShareCachePayload(payload, { expectedShareCount = null } = {}) {
  assertObject(payload, "win-share cache payload");
  if (payload.pending === true) {
    assertObject(payload.shares, "pending win-share shares");
    assertNonNegativeInteger(payload.totalCombos, "pending win-share totalCombos");
    return payload;
  }
  assertPositiveInteger(payload.totalCombos, "win-share totalCombos");
  assertObject(payload.shares, "win-share shares");
  if (expectedShareCount != null && Object.keys(payload.shares).length !== expectedShareCount) {
    throw new Error(`win-share shares must contain ${expectedShareCount} entries`);
  }
  const total = probabilityObjectTotal(payload.shares, "win-share shares");
  assertApproximatelyOne(total, "win-share shares");
  return payload;
}

export function validateMultiwayEquityCachePayload(payload, { expectedParticipants = null } = {}) {
  assertObject(payload, "multiway equity cache payload");
  assertObject(payload.equities, "multiway equities");
  assertNonNegativeInteger(payload.nsims, "multiway nsims");
  assertBoolean(payload.exact, "multiway exact");
  if (expectedParticipants != null && Object.keys(payload.equities).length !== expectedParticipants) {
    throw new Error(`multiway equities must contain ${expectedParticipants} participants`);
  }
  const total = probabilityObjectTotal(payload.equities, "multiway equities");
  if (Object.keys(payload.equities).length > 0) {
    assertApproximatelyOne(total, "multiway equities");
  }
  if (payload.approximation != null) {
    validateApproximation(payload.approximation, payload.exact);
  }
  return payload;
}

export function validateCompactPreflopMultiwayEquityCachePayload(payload, { playerCount = null } = {}) {
  assertObject(payload, "compact preflop multiway equity cache payload");
  assertProbability(payload.hero, "compact preflop hero equity");
  assertProbability(payload.villain, "compact preflop villain equity");
  assertNonNegativeInteger(payload.nsims, "compact preflop nsims");
  assertBoolean(payload.exact, "compact preflop exact");
  if (payload.playerCount != null) {
    assertPlayerCount(payload.playerCount, "compact preflop playerCount");
  }
  if (playerCount != null && payload.playerCount != null && payload.playerCount !== playerCount) {
    throw new Error(`compact preflop playerCount ${payload.playerCount} does not match ${playerCount}`);
  }
  return payload;
}

function validateApproximation(approximation, exact) {
  assertObject(approximation, "multiway approximation");
  if (approximation.method !== (exact ? "exact" : "monte-carlo")) {
    throw new Error("multiway approximation method must match exact flag");
  }
  assertNonNegativeNumber(approximation.maxStandardError, "multiway maxStandardError");
  assertNonNegativeNumber(approximation.conservativeMargin95, "multiway conservativeMargin95");
  assertObject(approximation.standardError, "multiway standardError");
  for (const [id, error] of Object.entries(approximation.standardError)) {
    assertNonNegativeNumber(error, `multiway standardError.${id}`);
  }
}

function probabilityObjectTotal(values, label) {
  return Object.entries(values).reduce((total, [key, value]) => total + assertProbability(value, `${label}.${key}`), 0);
}

function assertApproximatelyOne(value, label) {
  if (Math.abs(value - 1) > 1e-9) {
    throw new Error(`${label} sum to ${value}, expected 1`);
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

function assertBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
}

function assertProbability(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a probability`);
  }
  return value;
}

function assertNonNegativeNumber(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
}

function assertPlayerCount(value, label) {
  if (!Number.isInteger(value) || value < 2 || value > 6) {
    throw new Error(`${label} must be an integer from 2 through 6`);
  }
}
