import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260917200000_account_credit_ledger.sql',
);
const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

describe('account credit ledger migration contract', () => {
  it('defines the private append-only ledger and summary RPCs', () => {
    expect(sql).toMatch(/create table public\.credit_ledger_entries/i);
    expect(sql).toMatch(/credit_delta\s+bigint\s+not null/i);
    expect(sql).toMatch(/reference_key\s+text\s+not null\s+unique/i);
    expect(sql).toMatch(/alter table public\.credit_ledger_entries enable row level security/i);
    expect(sql).toMatch(/revoke all on table public\.credit_ledger_entries from public, anon, authenticated/i);
    expect(sql).toMatch(/grant select, insert on table public\.credit_ledger_entries to service_role/i);
    expect(sql).toMatch(/function public\.account_credit_summary\(\)/i);
    expect(sql).toMatch(/function public\.keco_admin_credit_summary\(\)/i);
    expect(sql).toMatch(/sum\([\s\S]*total_tokens[\s\S]*\+ 2[\s\S]*\/ 3/i);
  });
});
