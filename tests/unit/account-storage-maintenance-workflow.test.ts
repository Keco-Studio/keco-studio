import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const workflow = readFileSync(
  path.join(process.cwd(), '.github/workflows/account-storage-maintenance.yml'),
  'utf8'
);

describe('account storage maintenance workflow', () => {
  it('defaults to a read-only production report on main', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toMatch(/mode:\s*[\s\S]*type:\s*choice/);
    expect(workflow).toMatch(/default:\s*report/);
    expect(workflow).toMatch(/options:\s*\n\s*- report\s*\n\s*- apply/);
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain('https://lulrcirmwwvvnupmwqcq.supabase.co');
    expect(workflow).toContain('SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}');
  });

  it('requires explicit apply mode and reconciles after every run', () => {
    expect(workflow).toContain('npm run storage:backfill');
    expect(workflow).toContain("github.event.inputs.mode == 'apply'");
    expect(workflow).toContain('npm run storage:backfill -- --apply');
    expect(workflow).toContain('if: always()');
    expect(workflow).toContain('npm run storage:reconcile');
    expect(workflow).not.toContain('storage:reconcile -- --apply');
  });

  it('does not cancel an in-progress production repair', () => {
    expect(workflow).toContain('cancel-in-progress: false');
  });
});
