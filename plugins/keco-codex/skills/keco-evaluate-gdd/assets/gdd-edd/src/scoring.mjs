const round = (value) => Math.round((value + Number.EPSILON) * 10) / 10;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

export function distribution(scores = []) {
  const result = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const score of scores) if (result[score] !== undefined) result[score] += 1;
  return result;
}

function reasonCounts(ratings, field) {
  const counts = new Map();
  for (const rating of ratings) {
    for (const reason of rating[field] || []) counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

export function aggregateRatings(ratings = []) {
  const count = ratings.length;
  const average = (field) => count ? round(ratings.reduce((sum, rating) => sum + rating[field], 0) / count) : null;
  return {
    count,
    experienceValueAverage: average('experienceValueScore'),
    gameplaySystemsAverage: average('gameplaySystemsScore'),
    contentPresentationAverage: average('contentPresentationScore'),
    experienceValueDistribution: distribution(ratings.map((rating) => rating.experienceValueScore)),
    gameplaySystemsDistribution: distribution(ratings.map((rating) => rating.gameplaySystemsScore)),
    contentPresentationDistribution: distribution(ratings.map((rating) => rating.contentPresentationScore)),
    experienceValueReasons: reasonCounts(ratings, 'experienceValueReasons'),
    gameplaySystemsReasons: reasonCounts(ratings, 'gameplaySystemsReasons'),
    contentPresentationReasons: reasonCounts(ratings, 'contentPresentationReasons'),
  };
}

export function combineScores({ aiExperienceValueScore, aiGameplaySystemsScore, aiContentPresentationScore, aggregate }) {
  const aiExperienceValuePercent = round(clamp(aiExperienceValueScore, 0, 30) / 30 * 100);
  const aiGameplaySystemsPercent = round(clamp(aiGameplaySystemsScore, 0, 40) / 40 * 100);
  const aiContentPresentationPercent = round(clamp(aiContentPresentationScore, 0, 30) / 30 * 100);
  const playerExperienceValuePercent = aggregate.experienceValueAverage == null ? null : round(aggregate.experienceValueAverage * 20);
  const playerGameplaySystemsPercent = aggregate.gameplaySystemsAverage == null ? null : round(aggregate.gameplaySystemsAverage * 20);
  const playerContentPresentationPercent = aggregate.contentPresentationAverage == null ? null : round(aggregate.contentPresentationAverage * 20);
  const provisional = aggregate.count === 0;
  const combine = (ai, player) => player == null ? null : round(ai * 0.7 + player * 0.3);
  const experienceValue = combine(aiExperienceValuePercent, playerExperienceValuePercent);
  const gameplaySystems = combine(aiGameplaySystemsPercent, playerGameplaySystemsPercent);
  const contentPresentation = combine(aiContentPresentationPercent, playerContentPresentationPercent);
  return {
    provisional,
    aiExperienceValuePercent,
    aiGameplaySystemsPercent,
    aiContentPresentationPercent,
    playerExperienceValuePercent,
    playerGameplaySystemsPercent,
    playerContentPresentationPercent,
    experienceValue: provisional ? null : experienceValue,
    gameplaySystems: provisional ? null : gameplaySystems,
    contentPresentation: provisional ? null : contentPresentation,
    final: provisional || experienceValue == null || gameplaySystems == null || contentPresentation == null
      ? null
      : round(experienceValue * 0.3 + gameplaySystems * 0.4 + contentPresentation * 0.3),
  };
}
