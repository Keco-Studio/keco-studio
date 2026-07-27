import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(path.resolve(
  __dirname,
  '../../../supabase/migrations/20260722050000_mcp_final_review_hardening.sql'
), 'utf8');
const loadGate = fs.readFileSync(path.resolve(
  __dirname,
  '../../../scripts/fixtures/mcp-phase-2-load-gates.sql'
), 'utf8');

describe('MCP final review hardening migration', () => {
  it('precomputes private project/source-aware search documents with both GIN indexes', () => {
    expect(sql).toMatch(/create table public\.mcp_search_documents/i);
    expect(sql).toMatch(/primary key \(source_type, source_id\)/i);
    expect(sql).toMatch(/mcp_search_documents_project_source_idx[\s\S]+project_id, source_type/i);
    expect(sql).toMatch(/mcp_search_documents_search_vector_idx[\s\S]+using gin \(search_vector\)/i);
    expect(sql).toMatch(/mcp_search_documents_search_text_trgm_idx[\s\S]+gin_trgm_ops/i);
    expect(sql).toMatch(/force row level security/i);
    expect(sql).toMatch(/revoke all on table public\.mcp_search_documents[\s\S]+authenticated/i);
  });

  it('synchronizes every indexed source and takes bounded candidates before merging', () => {
    for (const table of [
      'libraries',
      'library_field_definitions',
      'library_assets',
      'library_asset_values',
      'documents',
    ]) {
      expect(sql).toMatch(new RegExp(
        `after insert or update or delete on public\\.${table}`,
        'i'
      ));
    }
    for (const pool of ['table_fts', 'document_fts', 'table_fuzzy', 'document_fuzzy']) {
      expect(sql).toMatch(new RegExp(`${pool} as materialized \\([\\s\\S]+limit v_candidate_limit`, 'i'));
    }
    expect(sql).toMatch(/v_candidate_limit := least\(120, greatest\(40, p_limit \* 4\)\)/i);
    expect(sql).toMatch(/from public\.mcp_search_documents as document/i);
  });

  it('has a deterministic CI plan gate for full-text and trigram indexes', () => {
    expect(loadGate).toMatch(/explain \(format json\)/i);
    expect(loadGate).toMatch(/mcp_search_documents_search_vector_idx/i);
    expect(loadGate).toMatch(/mcp_search_documents_search_text_trgm_idx/i);
    expect(loadGate).toMatch(/mcp_search_documents_project_source_idx/i);
    expect(loadGate).toMatch(/mcp_search_documents_pkey/i);
    expect(loadGate).toMatch(/v_count <> 101100/i);
    expect(loadGate).toMatch(/v_plan::text like '%Seq Scan%'/i);
  });

  it('requires exact reference keys and canonicalizes stored scalar and array values', () => {
    expect(sql).toMatch(/array\['assetId', 'fieldId'\]::text\[\]/i);
    expect(sql).toMatch(/reference entries require exactly assetId and fieldId/i);
    expect(sql).toMatch(/'assetId', v_asset_id::text[\s\S]+'fieldId', v_field_id::text/i);
    expect(sql).toMatch(/then public\.mcp_canonical_reference_value\(v_pair\.value\)/i);
  });
});
