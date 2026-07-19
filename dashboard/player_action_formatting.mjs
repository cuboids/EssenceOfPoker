export function actionLabel(action) {
  if (!action) {
    return "";
  }
  return action.amount != null ? `${action.type} ${formatAmount(action.amount)}` : action.type;
}

export function actionTagLabel(action, streetActions = []) {
  if (!action) {
    return "";
  }
  if (action.type === "small-blind") {
    return `posts SB ${formatAmount(action.amount)}`;
  }
  if (action.type === "big-blind") {
    return `posts BB ${formatAmount(action.amount)}`;
  }
  if (action.type === "bet" || action.type === "raise") {
    return aggressiveActionLabel(action, streetActions);
  }
  return action.type;
}

export function formatAmount(value) {
  const amount = normalizePositiveAmount(value);
  return Number.isInteger(amount) ? `${amount}` : `${amount.toFixed(1)}`;
}

function aggressiveActionLabel(action, streetActions) {
  const aggressiveActions = streetActions.filter((streetAction) =>
    streetAction.type === "bet" || streetAction.type === "raise" || streetAction.type === "all-in",
  );
  const actionIndex = Math.max(0, aggressiveActions.findIndex((streetAction) => streetAction.id === action.id));
  if (actionIndex === 0) {
    return "bets";
  }
  if (actionIndex === 1) {
    return "raises";
  }
  return `${actionIndex + 2}bets`;
}

function normalizePositiveAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("amount must be a positive number");
  }
  return Math.round(amount * 10) / 10;
}
