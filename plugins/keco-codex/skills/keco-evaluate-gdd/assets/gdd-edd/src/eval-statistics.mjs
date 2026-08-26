const round = (value) => Math.round((value + Number.EPSILON) * 10) / 10;

export function summarizeScores(values) {
  if (!Array.isArray(values) || values.length < 2) throw new Error('Statistics require at least 2 samples');
  const numbers = values.map(Number);
  if (numbers.some((value) => !Number.isFinite(value))) throw new Error('Score samples must be finite numbers');
  const meanRaw = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  const variance = numbers.reduce((sum, value) => sum + ((value - meanRaw) ** 2), 0) / (numbers.length - 1);
  return {
    values: numbers,
    mean: round(meanRaw),
    stddev: round(Math.sqrt(variance)),
    min: Math.min(...numbers),
    max: Math.max(...numbers),
  };
}

export function summarizeSamples(samples) {
  if (!Array.isArray(samples)) throw new Error('Samples must be an array');
  return {
    experienceValue: summarizeScores(samples.map((sample) => sample.experienceValueScore)),
    gameplaySystems: summarizeScores(samples.map((sample) => sample.gameplaySystemsScore)),
    contentPresentation: summarizeScores(samples.map((sample) => sample.contentPresentationScore)),
    total: summarizeScores(samples.map((sample) => sample.totalScore)),
  };
}

export function compareAggregates(baseline, current) {
  return Object.fromEntries(['experienceValue', 'gameplaySystems', 'contentPresentation', 'total'].map((key) => [key, round(current[key].mean - baseline[key].mean)]));
}
