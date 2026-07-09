import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const firstMigrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260109000001_optimize_rls_performance.sql'
);
const duplicateMigrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260109000002_optimize_rls_performance.sql'
);
const auditQueryPath = path.join(repoRoot, 'scripts/audit-duplicate-rls-migrations.sql');

describe('duplicate optimize_rls_performance migrations', () => {
  it('keeps both historical files byte-identical and idempotent', () => {
    const firstMigration = readFileSync(firstMigrationPath, 'utf8');
    const duplicateMigration = readFileSync(duplicateMigrationPath, 'utf8');

    expect(duplicateMigration).toBe(firstMigration);
    expect(firstMigration).toMatch(/CREATE INDEX IF NOT EXISTS/i);
    expect(firstMigration).not.toMatch(/DROP INDEX/i);
  });

  it('provides a read-only applied-state audit for both versions', () => {
    const auditQuery = readFileSync(auditQueryPath, 'utf8');
    const executableSql = auditQuery.replace(/^--.*$/gm, '');

    expect(auditQuery).toContain('20260109000001');
    expect(auditQuery).toContain('20260109000002');
    expect(auditQuery).toContain('supabase_migrations.schema_migrations');
    expect(auditQuery).toMatch(/SELECT[\s\S]*applied/i);
    expect(executableSql).not.toMatch(/\b(update|delete|insert|alter|drop|truncate)\b/i);
  });
});
