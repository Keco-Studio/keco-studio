import fs from 'node:fs';
import path from 'node:path';

const sqlPath = path.join(
  process.cwd(),
  'supabase/migrations/20261022010000_normalize_gdd_map_style_contract_null.sql',
);
const sql = fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, 'utf8') : '';

describe('GDD map style-contract null migration', () => {
  it('accepts the JSON null produced for an omitted Art Style', () => {
    expect(sql).toMatch(/alter table public\.gdd_map_artifacts/i);
    expect(sql).toMatch(/jsonb_typeof\(style_contract\)\s+in\s*\(\s*'object'\s*,\s*'null'\s*\)/i);
  });
});
