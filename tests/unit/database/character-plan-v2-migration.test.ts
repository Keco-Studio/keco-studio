import { readFileSync } from 'node:fs';
import path from 'node:path';

const sql = readFileSync(path.join(
  process.cwd(),
  'supabase/migrations/20260908090000_character_plan_v2_references.sql',
), 'utf8');

describe('Character Plan V2 reference migration', () => {
  it('keeps the RPC validator identity and supports strict V2 references', () => {
    expect(sql).toMatch(/create or replace function public\.character_validate_asset_plan_v1\(p_plan jsonb\)/i);
    expect(sql).toMatch(/coalesce\(v_schema_version, ''\) not in \('1', '2'\)/i);
    expect(sql).toMatch(/jsonb_array_length\(p_plan -> 'references'\) > 4/i);
    expect(sql).toMatch(/coalesce\(reference\.value ->> 'role', ''\) not in \('style', 'source'\)/i);
    expect(sql).toMatch(/jsonb_typeof\(reference\.value -> 'required'\).*'boolean'/i);
    expect(sql).toMatch(/group by reference\.value ->> 'assetId'[\s\S]*having count\(\*\) > 1/i);
  });

  it('preserves V1 animation validation and prompt safety checks', () => {
    expect(sql).toMatch(/v_kind = 'character'[\s\S]*else[\s\S]*v_schema_version is distinct from '1'/i);
    expect(sql).toMatch(/sourceCharacterAssetId[\s\S]*sourceCharacterSha256[\s\S]*frameCount/i);
    expect(sql).toMatch(/unsafe character asset prompt/i);
  });
});
