export const WIN_SIGNAL_THRESHOLDS = Object.freeze({
  oneBar: 0.0122,
  twoBars: 0.03571,
  threeBars: 0.1,
  fourBars: 0.25,
  fiveBars: 0.5,
  twoDeepBars: 0.75,
  threeDeepBars: 0.9,
  fourDeepBars: 0.96429,
  fiveDeepBars: 0.9878,
});

export function winShareSignal(share) {
  if (share == null || share <= 0) {
    return { level: 0, deepLevel: 0, isCertain: false };
  }
  if (share >= 1) {
    return { level: 5, deepLevel: 5, isCertain: true };
  }
  if (share >= WIN_SIGNAL_THRESHOLDS.fiveDeepBars) {
    return { level: 5, deepLevel: 5, isCertain: false };
  }
  if (share >= WIN_SIGNAL_THRESHOLDS.fourDeepBars) {
    return { level: 5, deepLevel: 4, isCertain: false };
  }
  if (share >= WIN_SIGNAL_THRESHOLDS.threeDeepBars) {
    return { level: 5, deepLevel: 3, isCertain: false };
  }
  if (share >= WIN_SIGNAL_THRESHOLDS.twoDeepBars) {
    return { level: 5, deepLevel: 2, isCertain: false };
  }
  if (share >= WIN_SIGNAL_THRESHOLDS.fiveBars) {
    return {
      level: 5,
      deepLevel: share === WIN_SIGNAL_THRESHOLDS.fiveBars ? 0 : 1,
      isCertain: false,
    };
  }
  if (share > WIN_SIGNAL_THRESHOLDS.fourBars) {
    return { level: 4, deepLevel: 0, isCertain: false };
  }
  if (share > WIN_SIGNAL_THRESHOLDS.threeBars) {
    return { level: 3, deepLevel: 0, isCertain: false };
  }
  if (share > WIN_SIGNAL_THRESHOLDS.twoBars) {
    return { level: 2, deepLevel: 0, isCertain: false };
  }
  if (share > WIN_SIGNAL_THRESHOLDS.oneBar) {
    return { level: 1, deepLevel: 0, isCertain: false };
  }
  return { level: 0, deepLevel: 0, isCertain: false };
}
