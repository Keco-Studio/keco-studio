import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRatingServer } from '../src/server.mjs';

test('one player response creates a combined result and updates in place', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'edd-e2e-'));
  const resultRoot = join(root, 'result');
  const progressRoot = join(root, 'progress');
  const problemRoot = join(root, 'problem');
  await Promise.all([resultRoot, progressRoot, problemRoot].map((path) => mkdir(path, { recursive: true })));
  await Promise.all([
    writeFile(join(progressRoot, 'evaluation-Progression.md'), `# Progression

## Input Materials

- AI Experience Value: 18/30
- AI Gameplay and Systems: 28/40
- AI Content and Presentation: 21/30

## Final Execution Result

- Player samples: 0
`),
    writeFile(join(problemRoot, 'evaluation-problem-log.md'), '# Problem\n'),
    writeFile(join(resultRoot, 'evaluation-evaluation-result.md'), `# Result

- Valid human samples: 0
- Final experience value: No human rating
- Final gameplay and systems: No human rating
- Final content and presentation: No human rating
- Final score: No human rating
`),
  ]);
  const app = await createRatingServer({ resultRoot, progressRoot, problemRoot, dataFile: join(root, 'store.json'), publicRoot: new URL('../public/', import.meta.url), host: '127.0.0.1', port: 0, rateLimit: 100 });
  await app.listen();
  t.after(() => app.close());
  const created = await app.createSessionForDocuments({ evaluationId: 'evaluation', gameTitle: 'Stray Cat Rescue', aiExperienceValueScore: 18, aiGameplaySystemsScore: 28, aiContentPresentationScore: 21, expiryDays: 7 });
  const endpoint = `${app.baseUrl}/api/public/sessions/${created.session.publicToken}/ratings`;
  const rating = { anonymousId: 'stable-browser-identity', experienceValueScore: 3, gameplaySystemsScore: 4, contentPresentationScore: 5, experienceValueReasons: [], gameplaySystemsReasons: [], contentPresentationReasons: [], comment: 'not in markdown' };
  await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rating) });
  assert.equal(app.store.getRatings(created.session.id).length, 1);
  const resultMarkdown = await readFile(join(resultRoot, created.documents.result), 'utf8');
  assert.match(resultMarkdown, /Valid human samples: 1/);
  assert.match(resultMarkdown, /Final experience value: 60\.0\/100/);
  assert.match(resultMarkdown, /Final gameplay and systems: 73\.0\/100/);
  assert.match(resultMarkdown, /Final content and presentation: 79\.0\/100/);
  assert.match(resultMarkdown, /Final score: 70\.9\/100/);
  assert.match(resultMarkdown, /Final total: 70\.9 pts/);
  assert.doesNotMatch(resultMarkdown, /conclusion|pass|fail/i);
  assert.doesNotMatch(resultMarkdown, /not in markdown/);

  const progressMarkdown = await readFile(join(progressRoot, created.documents.progress), 'utf8');
  assert.match(progressMarkdown, /EDD_PLAYER_PROGRESS_START/);
  assert.match(progressMarkdown, /## Player Rating Sync/);
  assert.match(progressMarkdown, /Valid samples: 1/);
  assert.match(progressMarkdown, /Result updated/);
  assert.doesNotMatch(progressMarkdown, /60\.0|73\.0|79\.0|70\.9|Final score/);
  assert.doesNotMatch(progressMarkdown, /conclusion|pass|fail/i);
});
