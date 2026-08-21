import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260821101000_gdd_version_semantic_titles.sql',
), 'utf8');

describe('GDD semantic version titles migration', () => {
  it('replaces generic document version numbers with a generated summary', () => {
    expect(sql).toMatch(/before insert on public\.document_versions/i);
    expect(sql).toMatch(/gdd_generation_metadata\s*->>\s*'versionSummary'/i);
    expect(sql).toMatch(/'Update '\s*\|\|\s*v_document_name/i);
  });

  it('attributes table and Script versions to the generation owner', () => {
    expect(sql).toMatch(/before insert on public\.library_versions/i);
    expect(sql).toMatch(/dialogue_generation_jobs[\s\S]*gdd_generation_jobs/i);
    expect(sql).toMatch(/new\.created_by\s*:=\s*coalesce\(v_owner_id/i);
    expect(sql).toMatch(/Update dialogue:/i);
    expect(sql).toMatch(/Update GDD resources for/i);
  });
});
