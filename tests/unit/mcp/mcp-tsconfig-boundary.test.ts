import { readFileSync } from 'node:fs';
import path from 'node:path';

it('keeps Deno Edge Functions outside the Next.js TypeScript project', () => {
  const tsconfig = JSON.parse(readFileSync(path.join(process.cwd(), 'tsconfig.json'), 'utf8'));

  expect(tsconfig.exclude).toContain('supabase/functions');
});
