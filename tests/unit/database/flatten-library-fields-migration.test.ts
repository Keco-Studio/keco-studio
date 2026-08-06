import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const migrationPath = path.resolve(
  __dirname,
  '../../../supabase/migrations/20260804010000_flatten_library_field_sections.sql'
);
const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

describe('flatten library field sections migration', () => {
  it('orders legacy sections by their minimum field order', () => {
    expect(sql).toMatch(/min\s*\(\s*[^)]*order_index\s*\)[\s\S]*(section_first_order|first_order)/i);
  });

  it('assigns deterministic flat row numbers within each library', () => {
    expect(sql).toMatch(/row_number\s*\(\s*\)\s*over\s*\(\s*partition\s+by\s+[^)]*library_id[\s\S]*section_first_order[\s\S]*order_index[\s\S]*id/i);
  });

  it('updates definitions without deleting fields and uses one private compatibility group', () => {
    expect(sql).toMatch(/update\s+public\.library_field_definitions/i);
    expect(sql).not.toMatch(/delete\s+from\s+public\.library_field_definitions/i);
    expect(sql).toContain('__keco_flat_fields__');
    expect(sql).toMatch(/md5\s*\([\s\S]*library_id\s*::text[\s\S]*keco-flat-fields/i);
  });

  it('uses two-phase negative temporary ordering before final flat ordering', () => {
    expect(sql).toMatch(/order_index\s*=\s*-\s*\(\s*[^)]*flat_order\s*\+\s*1\s*\)/i);
    expect(sql).toMatch(/set[\s\S]*order_index\s*=\s*snapshot\.flat_order/i);
  });
});
