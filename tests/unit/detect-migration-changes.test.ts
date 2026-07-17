import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const detectorPath = path.join(
  process.cwd(),
  'scripts/detect-migration-changes.sh'
);

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function writeFixture(cwd: string, relativePath: string, contents: string): void {
  const absolutePath = path.join(cwd, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents, 'utf8');
}

function commitAll(cwd: string, message: string): string {
  git(cwd, 'add', '--all');
  git(cwd, 'commit', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

function detectMigrationChanges(cwd: string, baseCommit: string): string[] {
  const result = spawnSync('bash', [detectorPath, baseCommit], {
    cwd,
    encoding: 'utf8',
  });

  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);

  return result.stdout.trim().split('\n').filter(Boolean);
}

describe('migration change detector', () => {
  let fixtureRoot: string;
  let baseCommit: string;

  beforeEach(() => {
    fixtureRoot = mkdtempSync(path.join(tmpdir(), 'migration-detector-'));
    git(fixtureRoot, 'init', '--initial-branch=main');
    git(fixtureRoot, 'config', 'user.email', 'ci@example.com');
    git(fixtureRoot, 'config', 'user.name', 'CI Test');
    writeFixture(fixtureRoot, 'README.md', '# Fixture\n');
    writeFixture(
      fixtureRoot,
      'supabase/migrations/20260101000000_initial.sql',
      'select 1;\n'
    );
    baseCommit = commitAll(fixtureRoot, 'initial');
  });

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('returns no paths for a UI-only change', () => {
    writeFixture(fixtureRoot, 'src/page.tsx', 'export default null;\n');
    commitAll(fixtureRoot, 'change UI');

    expect(detectMigrationChanges(fixtureRoot, baseCommit)).toEqual([]);
  });

  it('detects an added migration', () => {
    writeFixture(
      fixtureRoot,
      'supabase/migrations/20260102000000_added.sql',
      'select 2;\n'
    );
    commitAll(fixtureRoot, 'add migration');

    expect(detectMigrationChanges(fixtureRoot, baseCommit)).toEqual([
      'supabase/migrations/20260102000000_added.sql',
    ]);
  });

  it('detects a modified migration', () => {
    writeFixture(
      fixtureRoot,
      'supabase/migrations/20260101000000_initial.sql',
      'select 2;\n'
    );
    commitAll(fixtureRoot, 'modify migration');

    expect(detectMigrationChanges(fixtureRoot, baseCommit)).toEqual([
      'supabase/migrations/20260101000000_initial.sql',
    ]);
  });

  it('detects a deleted migration', () => {
    unlinkSync(
      path.join(
        fixtureRoot,
        'supabase/migrations/20260101000000_initial.sql'
      )
    );
    commitAll(fixtureRoot, 'delete migration');

    expect(detectMigrationChanges(fixtureRoot, baseCommit)).toEqual([
      'supabase/migrations/20260101000000_initial.sql',
    ]);
  });

  it('detects a renamed migration', () => {
    renameSync(
      path.join(
        fixtureRoot,
        'supabase/migrations/20260101000000_initial.sql'
      ),
      path.join(
        fixtureRoot,
        'supabase/migrations/20260101000000_renamed.sql'
      )
    );
    commitAll(fixtureRoot, 'rename migration');

    expect(detectMigrationChanges(fixtureRoot, baseCommit)).not.toEqual([]);
  });

  it('uses a release PR base instead of a diverged main branch', () => {
    git(fixtureRoot, 'switch', '--quiet', '-c', 'release/preview');
    writeFixture(
      fixtureRoot,
      'supabase/migrations/20260102000000_release.sql',
      'select 2;\n'
    );
    const releaseBase = commitAll(fixtureRoot, 'release migration');
    git(fixtureRoot, 'switch', '--quiet', '-c', 'feature/ui-only');
    writeFixture(fixtureRoot, 'src/page.tsx', 'export default null;\n');
    commitAll(fixtureRoot, 'change UI');

    expect(detectMigrationChanges(fixtureRoot, releaseBase)).toEqual([]);
    expect(detectMigrationChanges(fixtureRoot, baseCommit)).toEqual([
      'supabase/migrations/20260102000000_release.sql',
    ]);
  });

  it('fails when the base commit is unavailable', () => {
    const result = spawnSync('bash', [detectorPath, 'missing-base'], {
      cwd: fixtureRoot,
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("bad revision 'missing-base'");
  });
});
