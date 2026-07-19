import { rankSymbol } from "./cards.mjs";

export const RANGE_MATRIX_RANKS = Object.freeze(Array.from({ length: 13 }, (_, index) => index + 1));

export function rangeMatrixCells(range) {
  const classes = summarizeRangeClasses(range);
  return RANGE_MATRIX_RANKS.map((rowRank) =>
    RANGE_MATRIX_RANKS.map((columnRank) => {
      const classKey = matrixClassKey(rowRank, columnRank);
      const summary = classes.get(classKey) || { averageWeight: 0, combos: 0, weightedCombos: 0 };
      return {
        classKey,
        label: matrixCellLabel(rowRank, columnRank),
        type: matrixCellType(rowRank, columnRank),
        rowRank,
        columnRank,
        combos: summary.combos,
        weightedCombos: summary.weightedCombos,
        frequency: summary.averageWeight,
      };
    }),
  );
}

export function rangeMatrixSummary(range) {
  const totalCombos = range?.summary?.totalCombos ?? range?.combos?.length ?? 0;
  const weightedCombos = range?.summary?.weightedCombos
    ?? (range?.combos || []).reduce((sum, combo) => sum + (combo.weight || 0), 0);
  return {
    totalCombos,
    weightedCombos,
    frequency: totalCombos ? weightedCombos / totalCombos : 0,
  };
}

export function matrixClassKey(rowRank, columnRank) {
  if (rowRank === columnRank) {
    return `${rowRank}-${rowRank}-pair`;
  }
  const first = Math.min(rowRank, columnRank);
  const second = Math.max(rowRank, columnRank);
  return `${first}-${second}-${rowRank < columnRank ? "suited" : "offsuit"}`;
}

export function matrixCellLabel(rowRank, columnRank) {
  if (rowRank === columnRank) {
    return `${rankSymbol(rowRank)}${rankSymbol(columnRank)}`;
  }
  const first = Math.min(rowRank, columnRank);
  const second = Math.max(rowRank, columnRank);
  return `${rankSymbol(first)}${rankSymbol(second)}`;
}

function matrixCellType(rowRank, columnRank) {
  if (rowRank === columnRank) {
    return "pair";
  }
  return rowRank < columnRank ? "suited" : "offsuit";
}

function summarizeRangeClasses(range) {
  const classes = new Map();
  for (const combo of range?.combos || []) {
    const summary = classes.get(combo.classKey) || { combos: 0, weightedCombos: 0, averageWeight: 0 };
    summary.combos += 1;
    summary.weightedCombos += combo.weight || 0;
    summary.averageWeight = summary.combos ? summary.weightedCombos / summary.combos : 0;
    classes.set(combo.classKey, summary);
  }
  return classes;
}
