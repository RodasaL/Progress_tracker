export const LEVEL_STEP = 120;

export function getLevelFromPoints(points) {
  const safePoints = Math.max(0, Number(points) || 0);
  return Math.floor(safePoints / LEVEL_STEP) + 1;
}

export function getProgressToNextLevel(points) {
  const safePoints = Math.max(0, Number(points) || 0);
  return (safePoints % LEVEL_STEP) / LEVEL_STEP;
}

export function getDailyDelta({
  donePoints,
  totalPoints,
  perfectDayBonus = 30,
  missedPointsPenaltyRate = 0.6
}) {
  const safeDonePoints = Math.max(0, Number(donePoints) || 0);
  const safeTotalPoints = Math.max(0, Number(totalPoints) || 0);

  if (safeTotalPoints === 0) {
    return 0;
  }

  if (safeDonePoints >= safeTotalPoints) {
    return safeTotalPoints + perfectDayBonus;
  }

  const missedPoints = safeTotalPoints - safeDonePoints;
  const weightedPenalty = Math.round(missedPoints * missedPointsPenaltyRate);
  return safeDonePoints - weightedPenalty;
}

export function daysBetween(dateA, dateB) {
  const a = new Date(dateA);
  const b = new Date(dateB);

  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());

  return Math.floor((utcB - utcA) / 86400000);
}

export function applyDelta(currentPoints, delta) {
  return Math.max(0, (Number(currentPoints) || 0) + (Number(delta) || 0));
}
