import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore, hashRespondent } from '../src/store.mjs';

test('creates unique sessions and persists after reload', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edd-store-'));
  const file = join(dir, 'store.json');
  const store = new JsonStore(file);
  await store.init();
  const first = await store.createSession({ gameTitle: 'A', resultDocument: 'a.md', aiExperienceValueScore: 24, aiGameplaySystemsScore: 32, aiContentPresentationScore: 24, expiresAt: new Date(Date.now() + 86400000).toISOString() });
  const second = await store.createSession({ gameTitle: 'B', resultDocument: 'b.md', aiExperienceValueScore: 24, aiGameplaySystemsScore: 32, aiContentPresentationScore: 24, expiresAt: new Date(Date.now() + 86400000).toISOString() });
  assert.notEqual(first.publicToken, second.publicToken);
  const reloaded = new JsonStore(file);
  await reloaded.init();
  assert.equal(reloaded.getSessionByToken(first.publicToken).gameTitle, 'A');
  assert.doesNotReject(async () => JSON.parse(await readFile(file, 'utf8')));
});

test('upserts one rating per respondent and blocks closed sessions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edd-store-'));
  const store = new JsonStore(join(dir, 'store.json'));
  await store.init();
  const session = await store.createSession({ gameTitle: 'A', resultDocument: 'a.md', aiExperienceValueScore: 24, aiGameplaySystemsScore: 32, aiContentPresentationScore: 24, expiresAt: new Date(Date.now() + 86400000).toISOString() });
  const respondentHash = hashRespondent(session.id, 'browser-1');
  await store.upsertRating(session.id, respondentHash, { experienceValueScore: 2, gameplaySystemsScore: 3, contentPresentationScore: 4, experienceValueReasons: [], gameplaySystemsReasons: [], contentPresentationReasons: [], comment: '' });
  await store.upsertRating(session.id, respondentHash, { experienceValueScore: 5, gameplaySystemsScore: 4, contentPresentationScore: 5, experienceValueReasons: [], gameplaySystemsReasons: [], contentPresentationReasons: [], comment: 'updated' });
  assert.equal(store.getRatings(session.id).length, 1);
  assert.equal(store.getRatings(session.id)[0].experienceValueScore, 5);
  await store.closeSession(session.id);
  await assert.rejects(store.upsertRating(session.id, 'other', { experienceValueScore: 5, gameplaySystemsScore: 5, contentPresentationScore: 5, experienceValueReasons: [], gameplaySystemsReasons: [], contentPresentationReasons: [], comment: '' }), /closed/i);
});

test('blocks expired sessions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edd-store-'));
  const store = new JsonStore(join(dir, 'store.json'));
  await store.init();
  const session = await store.createSession({ gameTitle: 'A', resultDocument: 'a.md', aiExperienceValueScore: 24, aiGameplaySystemsScore: 32, aiContentPresentationScore: 24, expiresAt: new Date(Date.now() - 1000).toISOString() });
  await assert.rejects(store.upsertRating(session.id, 'x', { experienceValueScore: 3, gameplaySystemsScore: 3, contentPresentationScore: 3, experienceValueReasons: [], gameplaySystemsReasons: [], contentPresentationReasons: [], comment: '' }), /expired/i);
});

test('deletes a failed workflow session and its ratings', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edd-store-'));
  const store = await new JsonStore(join(dir, 'store.json')).init();
  const session = await store.createSession({ gameTitle: 'Paws', expiresAt: new Date(Date.now() + 60_000).toISOString() });
  await store.upsertRating(session.id, 'respondent', { experienceValueScore: 5, gameplaySystemsScore: 5, contentPresentationScore: 5 });
  await store.deleteSession(session.id);
  assert.equal(store.getSession(session.id), null);
  assert.equal(store.getRatings(session.id).length, 0);
});
