import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const remoteSeed = readFileSync(path.join(repoRoot, 'supabase/seed-remote.sql'), 'utf8');
const localSeed = readFileSync(path.join(repoRoot, 'supabase/seed.sql'), 'utf8');
const seedScript = readFileSync(path.join(repoRoot, 'scripts/seed-remote.sh'), 'utf8');
const supabaseConfig = readFileSync(path.join(repoRoot, 'supabase/config.toml'), 'utf8');

describe('remote seed password hardening (issue #155)', () => {
  it('does not commit a usable password in the remote seed SQL', () => {
    expect(remoteSeed).not.toContain('Password123!');
    expect(remoteSeed).not.toMatch(/crypt\(\s*'[^']+'/);
    expect(remoteSeed).toContain(":'seed_password'");
    expect(remoteSeed).toContain("current_setting('app.seed_password'");
  });

  it('requires SEED_TEST_PASSWORD and passes it as a psql variable', () => {
    expect(seedScript).toContain('SEED_TEST_PASSWORD');
    expect(seedScript).toContain('seed_password="$SEED_TEST_PASSWORD"');
    expect(seedScript).toMatch(/if \[ -z "\$SEED_TEST_PASSWORD" \]/);
    expect(seedScript).not.toContain('Password123!');
  });

  it('documents that the fixed local seed password is local and CI only', () => {
    expect(localSeed).toContain('Password123!');
    expect(localSeed.slice(0, 700)).toMatch(/local\/CI/i);
    expect(localSeed.slice(0, 700)).toMatch(/never targets a public remote/i);
  });

  it('raises the configured minimum auth password length', () => {
    const match = supabaseConfig.match(/minimum_password_length\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(12);
  });
});
