import { randomBytes } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';

const REASON_LABELS = {
  unclear_goal: 'Unclear experience goal', weak_motivation: 'Weak player motivation', vague_fantasy: 'Vague core fantasy', low_differentiation: 'Low differentiation', unclear_emotion: 'Unclear expected emotion',
  weak_loop: 'Weak core loop', low_agency: 'Low player agency', weak_feedback: 'Insufficient feedback', poor_difficulty: 'Unreasonable difficulty', unbalanced_progression: 'Progression or balance issues',
  unclear_structure: 'Unclear content structure', weak_narrative: 'Weak narrative support', ui_clarity: 'Unclear UI information', visual_inconsistency: 'Inconsistent visual style', audio_gap: 'Insufficient audio design',
};

const distributionLine = (values) => [1, 2, 3, 4, 5].map((score) => `${score} pts ${values?.[score] || 0} raters`).join(' / ');
const reasonsLine = (items = []) => items.length ? items.slice(0, 5).map(({ reason, count }) => `${REASON_LABELS[reason] || reason} ${count} times`).join('; ') : 'None';
const score = (value) => value == null ? 'No human rating yet' : `${value.toFixed(1)} pts`;
const decimal = (value) => Number.isFinite(value) ? value.toFixed(1) : 'N/A';

export function renderRatingSection(session, aggregate, combined, syncedAt = new Date().toISOString()) {
  return `## Player Ratings and Combined Results

- Game: ${session.gameTitle}
- Valid samples: ${aggregate.count}
- Data status: ${combined.provisional ? 'No human ratings yet; combined total not generated' : 'Combined results generated'}
- Synced at: ${syncedAt}

### Experience Value (30%)

- Player average: ${aggregate.experienceValueAverage == null ? 'N/A' : `${aggregate.experienceValueAverage.toFixed(1)} / 5`}
- Distribution: ${distributionLine(aggregate.experienceValueDistribution)}
- Top reasons: ${reasonsLine(aggregate.experienceValueReasons)}
- AI score: ${session.aiExperienceValueScore.toFixed(1)} / 30 (scaled ${decimal(combined.aiExperienceValuePercent)} / 100)
- Combined dimension score: ${score(combined.experienceValue)}

### Gameplay and Systems (40%)

- Player average: ${aggregate.gameplaySystemsAverage == null ? 'N/A' : `${aggregate.gameplaySystemsAverage.toFixed(1)} / 5`}
- Distribution: ${distributionLine(aggregate.gameplaySystemsDistribution)}
- Top reasons: ${reasonsLine(aggregate.gameplaySystemsReasons)}
- AI score: ${session.aiGameplaySystemsScore.toFixed(1)} / 40 (scaled ${decimal(combined.aiGameplaySystemsPercent)} / 100)
- Combined dimension score: ${score(combined.gameplaySystems)}

### Content and Presentation (30%)

- Player average: ${aggregate.contentPresentationAverage == null ? 'N/A' : `${aggregate.contentPresentationAverage.toFixed(1)} / 5`}
- Distribution: ${distributionLine(aggregate.contentPresentationDistribution)}
- Top reasons: ${reasonsLine(aggregate.contentPresentationReasons)}
- AI score: ${session.aiContentPresentationScore.toFixed(1)} / 30 (scaled ${decimal(combined.aiContentPresentationPercent)} / 100)
- Combined dimension score: ${score(combined.contentPresentation)}

### Combined Total

- Formula: each dimension = AI percent score x 70% + player percent score x 30%; total = Experience Value x 30% + Gameplay and Systems x 40% + Content and Presentation x 30%
- Final total: ${score(combined.final)}
`;
}

export function renderProgressRatingSection(session, aggregate, combined, syncedAt = new Date().toISOString()) {
  return `## Player Rating Sync

- Synced at: ${syncedAt}
- Valid samples: ${aggregate.count}
- Status: Result updated
- Result: ../result/${session.resultDocument}
`;
}

export function updateResultSummary(markdown, aggregate, combined) {
  const scoreValue = (value, empty) => value == null ? empty : `${value.toFixed(1)}/100`;
  const values = [
    ['Valid human samples', ': ', String(aggregate.count)],
    ['Final experience value', ': ', scoreValue(combined.experienceValue, 'No human rating')],
    ['Final gameplay and systems', ': ', scoreValue(combined.gameplaySystems, 'No human rating')],
    ['Final content and presentation', ': ', scoreValue(combined.contentPresentation, 'No human rating')],
    ['Final score', ': ', scoreValue(combined.final, 'No human rating')],
  ];
  let updated = markdown;
  for (const [label, separator, value] of values) {
    updated = updated.replace(new RegExp(`^- ${label}${separator}\\s*.*$`, 'm'), `- ${label}${separator}${value}`);
  }
  return updated;
}

function replaceManagedSection(markdown, sessionId, section, kind, label) {
  const start = `<!-- EDD_PLAYER_${kind}_START:${sessionId} -->`;
  const end = `<!-- EDD_PLAYER_${kind}_END:${sessionId} -->`;
  const markers = [...markdown.matchAll(new RegExp(`<!-- EDD_PLAYER_${kind}_(START|END):([^ ]+) -->`, 'g'))];
  let open = null;
  for (const marker of markers) {
    if (marker[1] === 'START') {
      if (open) throw new Error(`${label} marker incomplete`);
      open = marker[2];
    } else {
      if (!open || open !== marker[2]) throw new Error(`${label} marker does not match session`);
      open = null;
    }
  }
  if (open) throw new Error(`${label} marker incomplete`);
  if (markers.filter((marker) => marker[1] === 'START' && marker[2] === sessionId).length > 1) throw new Error(`${label} marker duplicated`);
  const ownStart = markdown.indexOf(start);
  const ownEnd = markdown.indexOf(end);
  if ((ownStart >= 0) !== (ownEnd >= 0) || ownStart > ownEnd) throw new Error(`${label} marker incomplete`);
  const block = `${start}\n${section.trim()}\n${end}`;
  if (ownStart >= 0) return `${markdown.slice(0, ownStart)}${block}${markdown.slice(ownEnd + end.length)}`;
  return `${markdown.trimEnd()}\n\n${block}\n`;
}

export function replaceRatingSection(markdown, sessionId, section) {
  return replaceManagedSection(markdown, sessionId, section, 'RATINGS', 'Player ratings');
}

export function replaceProgressRatingSection(markdown, sessionId, section) {
  return replaceManagedSection(markdown, sessionId, section, 'PROGRESS', 'Player rating sync');
}

async function writeMarkdown(path, updated) {
  const temp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temp, updated, 'utf8');
  await rename(temp, path);
  return updated;
}

export async function syncResultDocument(path, sessionId, section, aggregate, combined) {
  const markdown = await readFile(path, 'utf8');
  const withSection = replaceRatingSection(markdown, sessionId, section);
  return writeMarkdown(path, aggregate && combined ? updateResultSummary(withSection, aggregate, combined) : withSection);
}

export async function syncProgressDocument(path, sessionId, section) {
  const markdown = await readFile(path, 'utf8');
  return writeMarkdown(path, replaceProgressRatingSection(markdown, sessionId, section));
}
