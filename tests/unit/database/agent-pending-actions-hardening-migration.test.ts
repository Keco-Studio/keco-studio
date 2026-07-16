import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260716065000_harden_agent_pending_actions.sql'
);

describe('agent pending actions hardening migration', () => {
  it('drops authenticated management policies without recreating them', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    for (const policy of [
      'Users can view own pending actions',
      'Users can insert own pending actions',
      'Users can update own pending actions',
      'Users can delete own pending actions',
    ]) {
      expect(sql).toContain(
        `DROP POLICY IF EXISTS "${policy}" ON public.agent_pending_actions;`
      );
    }
    expect(sql).not.toMatch(/CREATE\s+POLICY[\s\S]*agent_pending_actions/i);
    expect(sql).not.toMatch(/TO\s+authenticated/i);
  });
});
