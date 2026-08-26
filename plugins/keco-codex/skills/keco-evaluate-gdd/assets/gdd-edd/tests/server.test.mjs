import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRatingServer } from '../src/server.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'edd-server-'));
  const resultRoot = join(root, 'result');
  const dataFile = join(root, 'data', 'store.json');
  const progressRoot = join(root, 'progress');
  const problemRoot = join(root, 'problem');
  await import('node:fs/promises').then(({ mkdir }) => Promise.all([resultRoot, progressRoot, problemRoot].map((path) => mkdir(path, { recursive: true }))));
  await Promise.all([
    writeFile(join(resultRoot, 'result-evaluation-result.md'), '# Result\n'),
    writeFile(join(progressRoot, 'result-Progression.md'), '# Progression\n'),
    writeFile(join(problemRoot, 'result-problem-log.md'), '# Problem\n'),
  ]);
  const app = await createRatingServer({ resultRoot, progressRoot, problemRoot, dataFile, publicRoot: new URL('../public/', import.meta.url), host: '127.0.0.1', port: 0, rateLimit: 100 });
  await app.listen();
  return { app, root, resultRoot, progressRoot, problemRoot, base: app.baseUrl };
}

const json = (url, options = {}) => fetch(url, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
test('AI-created documents and public rating work without admin HTTP routes', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  assert.equal((await fetch(`${f.base}/admin`)).status, 404);
  assert.equal((await fetch(`${f.base}/api/admin/sessions`)).status, 404);

  const created = await f.app.createSessionForDocuments({ evaluationId: 'result', gameTitle: 'Stray Cat Rescue', aiExperienceValueScore: 24, aiGameplaySystemsScore: 32, aiContentPresentationScore: 27, expiryDays: 7 });
  const publicSession = await fetch(`${f.base}/api/public/sessions/${created.session.publicToken}`).then((r) => r.json());
  assert.equal(publicSession.session.gameTitle, 'Stray Cat Rescue');
  assert.equal(publicSession.session.aiExperienceValueScore, undefined);

  const body = { anonymousId: 'browser-one-long-id', experienceValueScore: 4, gameplaySystemsScore: 3, contentPresentationScore: 5, experienceValueReasons: ['unclear_goal'], gameplaySystemsReasons: ['weak_feedback'], contentPresentationReasons: ['ui_clarity'], comment: 'private comment' };
  assert.equal((await json(`${f.base}/api/public/sessions/${created.session.publicToken}/ratings`, { method: 'POST', body: JSON.stringify(body) })).status, 200);
  assert.equal((await json(`${f.base}/api/public/sessions/${created.session.publicToken}/ratings`, { method: 'POST', body: JSON.stringify({ ...body, experienceValueScore: 5 }) })).status, 200);
  assert.equal(f.app.store.getRatings(created.session.id).length, 1);
  const markdown = await readFile(join(f.resultRoot, created.documents.result), 'utf8');
  assert.match(markdown, /EDD_PLAYER_RATINGS_START/);
  assert.doesNotMatch(markdown, /private comment/);
});

test('rejects invalid, expired, and unknown submissions', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const invalid = await json(`${f.base}/api/public/sessions/nope/ratings`, { method: 'POST', body: '{}' });
  assert.equal(invalid.status, 404);
});

test('rejects legacy two-dimension sessions instead of mixing score models', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const legacy = await f.app.store.createSession({
    gameTitle: 'Legacy rating', aiCoreScore: 40, aiExperienceScore: 35,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  const response = await fetch(`${f.base}/api/public/sessions/${legacy.publicToken}`);
  assert.equal(response.status, 410);
  assert.match((await response.json()).error, /three-dimension evaluation/i);
});

test('rejects a session when AI has not created all three documents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edd-rollback-'));
  const roots = { resultRoot: join(root, 'result'), progressRoot: join(root, 'progress'), problemRoot: join(root, 'problem') };
  const app = await createRatingServer({ ...roots, dataFile: join(root, 'store.json'), publicRoot: new URL('../public/', import.meta.url), host: '127.0.0.1', port: 0 });
  await assert.rejects(app.createSessionForDocuments({ evaluationId: 'missing', gameTitle: 'Paws & Patience', aiExperienceValueScore: 30, aiGameplaySystemsScore: 40, aiContentPresentationScore: 30, expiryDays: 7 }), /ENOENT/);
});
