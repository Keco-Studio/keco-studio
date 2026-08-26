import { access, readdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXPERIENCE_VALUE_REASONS = ['unclear_goal', 'weak_motivation', 'vague_fantasy', 'low_differentiation', 'unclear_emotion'];
export const GAMEPLAY_SYSTEMS_REASONS = ['weak_loop', 'low_agency', 'weak_feedback', 'poor_difficulty', 'unbalanced_progression'];
export const CONTENT_PRESENTATION_REASONS = ['unclear_structure', 'weak_narrative', 'ui_clarity', 'visual_inconsistency', 'audio_gap'];

const fail = (message) => { throw new Error(message); };
const integer = (value, min, max, label) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) fail(`${label} must be an integer from ${min} to ${max}`);
  return number;
};

export function validateRating(input = {}) {
  const experienceValueScore = integer(input.experienceValueScore, 1, 5, 'Experience Value rating');
  const gameplaySystemsScore = integer(input.gameplaySystemsScore, 1, 5, 'Gameplay and Systems rating');
  const contentPresentationScore = integer(input.contentPresentationScore, 1, 5, 'Content and Presentation rating');
  const validateReasons = (values, allowed) => {
    if (!Array.isArray(values) || values.length > allowed.length || values.some((value) => !allowed.includes(value))) fail('Unknown issue reason included');
    return [...new Set(values)];
  };
  const comment = typeof input.comment === 'string' ? input.comment.trim() : '';
  if (comment.length > 300) fail('Feedback may contain at most 300 characters');
  return {
    experienceValueScore,
    gameplaySystemsScore,
    contentPresentationScore,
    experienceValueReasons: validateReasons(input.experienceValueReasons || [], EXPERIENCE_VALUE_REASONS),
    gameplaySystemsReasons: validateReasons(input.gameplaySystemsReasons || [], GAMEPLAY_SYSTEMS_REASONS),
    contentPresentationReasons: validateReasons(input.contentPresentationReasons || [], CONTENT_PRESENTATION_REASONS),
    comment,
  };
}

export async function resolveResultDocument(name, root) {
  if (typeof name !== 'string' || basename(name) !== name || !name.endsWith('.md')) fail('Result document invalid');
  const rootPath = root instanceof URL ? fileURLToPath(root) : resolve(root);
  let files;
  try { files = await readdir(rootPath); } catch { fail('Result document directory unavailable'); }
  if (!files.includes(name)) fail('Result document not in allow list');
  const path = resolve(rootPath, name);
  await access(path);
  return path;
}
