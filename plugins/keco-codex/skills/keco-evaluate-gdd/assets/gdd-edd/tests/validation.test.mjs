import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRating, resolveResultDocument } from '../src/validation.mjs';

test('rating accepts fixed values and rejects invalid fields', () => {
  const valid = {
    experienceValueScore: 1, gameplaySystemsScore: 5, contentPresentationScore: 3,
    experienceValueReasons: ['unclear_goal'], gameplaySystemsReasons: ['weak_loop'], contentPresentationReasons: ['ui_clarity'], comment: 'ok',
  };
  assert.equal(validateRating(valid).experienceValueScore, 1);
  assert.throws(() => validateRating({ ...valid, experienceValueScore: 0 }), /1.*5/);
  assert.throws(() => validateRating({ ...valid, gameplaySystemsReasons: ['invented'] }), /reason/i);
  assert.throws(() => validateRating({ ...valid, comment: 'x'.repeat(301) }), /300/);
});

test('document resolver only accepts listed markdown basenames', async () => {
  const root = new URL('./fixtures-results/', import.meta.url);
  await assert.rejects(resolveResultDocument('../outside.md', root), /document/i);
  await assert.rejects(resolveResultDocument('file.txt', root), /document/i);
});
