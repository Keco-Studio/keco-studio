import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260915110000_ai_usage_accounting.sql',
);
const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

describe('AI usage accounting migration contract', () => {
  it('defines an idempotent private ledger and authenticated recorder', () => {
    expect(sql).toMatch(/create table public\.ai_usage_events/i);
    expect(sql).toMatch(/unique[\s\S]+event_key/i);
    expect(sql).toMatch(/on delete set null/i);
    expect(sql).toMatch(/create (or replace )?function public\.record_ai_usage_event\(p_event jsonb\)/i);
    expect(sql).toMatch(/auth\.uid\(\)/i);
    expect(sql).toMatch(/revoke all on table public\.ai_usage_events from public, anon, authenticated/i);
  });

  it('defines the aggregate with aggregate-first Credit rounding', () => {
    expect(sql).toMatch(/create (or replace )?function public\.keco_admin_ai_usage_summary\(\)/i);
    expect(sql).toMatch(/sum\([\s\S]*total_tokens[\s\S]*\+ 2[\s\S]*\/ 3/i);
  });
});
