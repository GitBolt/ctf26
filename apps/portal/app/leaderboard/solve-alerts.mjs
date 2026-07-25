/**
 * What changed for one row since the viewer last saw it.
 *
 * The snapshot is a shared, cached document with no per-viewer history, so this
 * is derived on the client from the previous poll. `delta` is positive when the
 * row climbed. A first solve carries no delta — an unranked row has no rank to
 * subtract from — so that jump is reported as a debut instead.
 */
export function rowMovement({ row, priorRank, priorPoints, priorSolveCount, firstComparison = false }) {
  const knownBefore = Number.isFinite(priorPoints);
  const wasRanked = Number.isSafeInteger(priorRank);
  const isRanked = Number.isSafeInteger(row?.rank);
  const completedChallenge = Number.isSafeInteger(priorSolveCount)
    && Number.isSafeInteger(row?.solveCount)
    && row.solveCount > priorSolveCount;
  const gained = completedChallenge || (knownBefore && row.points > priorPoints);
  const debut = isRanked && !wasRanked && (knownBefore || !firstComparison);
  const delta = wasRanked && isRanked ? priorRank - row.rank : 0;
  if (!debut && delta === 0 && !gained) return null;
  return { delta, gained, debut };
}

export function verifiedSolveCount(snapshot) {
  return Object.values(snapshot?.challengeValues || {}).reduce((total, challenge) => {
    const solveCount = Number(challenge?.solveCount);
    return total + (Number.isSafeInteger(solveCount) && solveCount > 0 ? solveCount : 0);
  }, 0);
}
