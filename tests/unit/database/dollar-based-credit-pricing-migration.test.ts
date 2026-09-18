import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260918120000_dollar_based_credit_pricing.sql',
);
const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

describe('dollar-based credit pricing migration contract', () => {
  it('creates append-only model price versions and records exact USD costs', () => {
    expect(sql).toMatch(/create table public\.ai_model_price_versions/i);
    expect(sql).toMatch(/usd_cost numeric/i);
    expect(sql).toMatch(/price_version_id uuid/i);
    expect(sql).toMatch(/create trigger .*ai_usage_cost/i);
  });

  it('seeds deepseek-flash peak and off-peak prices then aggregates three Credits per USD', () => {
    expect(sql).toMatch(/'deepseek', 'deepseek-flash', 'off_peak'/i);
    expect(sql).toMatch(/'deepseek', 'deepseek-flash', 'peak'/i);
    expect(sql).toMatch(/sum\(usd_cost\).*\* 3/i);
  });
});
