import { describe, expect, it } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260923152000_account_storage_inventory_rpc.sql'
);

describe('account storage inventory RPC migration', () => {
  it('exposes bounded accounted-object inventory only to service_role', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/create function public\.service_account_storage_inventory\(/i);
    expect(sql).toMatch(/security definer[\s\S]*set search_path = ''/i);
    expect(sql).toMatch(/object\.bucket_id in \([\s\S]*'tiptap-images'[\s\S]*\)/i);
    expect(sql).toMatch(/object\.metadata ->> 'size' ~ '\^\[0-9\]\+\$'[\s\S]*between 1 and 9223372036854775807/i);
    expect(sql).toMatch(/coalesce\([\s\S]*object\.owner[\s\S]*object\.owner_id/i);
    expect(sql).toMatch(/limit least\(greatest\(p_limit, 1\), 1000\)/i);
    expect(sql).toMatch(/revoke all on function public\.service_account_storage_inventory[\s\S]*from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.service_account_storage_inventory[\s\S]*to service_role/i);
  });
});
