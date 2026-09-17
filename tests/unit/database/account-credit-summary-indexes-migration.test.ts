import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260917210000_account_credit_summary_indexes.sql',
);
const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

describe('account credit summary index migration contract', () => {
  it('indexes all per-user Credit inputs', () => {
    expect(sql).toMatch(
      /create index ai_usage_events_credit_user_idx\s+on public\.ai_usage_events \(user_id\)/i,
    );
    expect(sql).toMatch(/where\s+pricing_rule_version = 1\s+or\s+\([\s\S]*provider = 'deepseek'[\s\S]*request_kind = 'chat_completion'[\s\S]*usage_status = 'unknown'[\s\S]*\)/i);
    expect(sql).toMatch(
      /create index credit_ledger_entries_user_id_idx\s+on public\.credit_ledger_entries \(user_id\)/i,
    );
  });

  it('makes the own-account usage query eligible for the partial index', () => {
    expect(sql).toMatch(/function public\.account_credit_summary\(\)/i);
    expect(sql).toMatch(/where event\.user_id = v_user_id\s+and \(\s*event\.pricing_rule_version = 1\s+or\s+\([\s\S]*event\.provider = 'deepseek'[\s\S]*event\.request_kind = 'chat_completion'[\s\S]*event\.usage_status = 'unknown'[\s\S]*\)\s*\)/i);
    expect(sql).toMatch(/\(usage\.deepseek_tokens \+ 2\) \/ 3 as used/i);
  });

  it('preserves the own-account function permission boundary', () => {
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = ''/i);
    expect(sql).toMatch(/revoke all on function public\.account_credit_summary\(\) from public, anon, authenticated, service_role/i);
    expect(sql).toMatch(/grant execute on function public\.account_credit_summary\(\) to authenticated/i);
  });
});
