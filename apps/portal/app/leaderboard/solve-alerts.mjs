export function verifiedSolveCount(snapshot) {
  return Object.values(snapshot?.challengeValues || {}).reduce((total, challenge) => {
    const solveCount = Number(challenge?.solveCount);
    return total + (Number.isSafeInteger(solveCount) && solveCount > 0 ? solveCount : 0);
  }, 0);
}
