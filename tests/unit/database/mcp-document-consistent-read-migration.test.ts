import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(path.resolve(__dirname,
  '../../../supabase/migrations/20260722030000_mcp_document_consistent_read.sql'), 'utf8');

describe('MCP consistent document read migration', () => {
  it('defines one stable security-definer SQL snapshot read using caller membership', () => {
    expect(migration).toMatch(/function public\.mcp_read_document_transport_state/i);
    expect(migration).toMatch(/language sql\s+security definer\s+stable/i);
    expect(migration).toMatch(/select auth\.uid\(\) as user_id/i);
    expect(migration).toMatch(/pc\.accepted_at is not null/i);
    expect(migration).toMatch(/where d\.id = p_document_id/i);
  });

  it('returns the current-epoch tail in deterministic order from the same statement', () => {
    expect(migration).toMatch(/u\.document_id = d\.id and u\.epoch = d\.collab_epoch/i);
    expect(migration).toMatch(/jsonb_agg\([\s\S]+order by u\.created_at, u\.id\)/i);
    expect(migration).not.toMatch(/language plpgsql/i);
  });

  it('bounds row count, encoded tail bytes, and total transport size before aggregation', () => {
    expect(migration).toMatch(/tail_sample[\s\S]+order by u\.created_at, u\.id\s+limit 2001/i);
    expect(migration).toMatch(/update_count[^;]+> 2000/i);
    expect(migration).toMatch(/update_bytes[^;]+> 2097152/i);
    expect(migration).toContain('> 15728640');
    expect(migration).toMatch(/octet_length\(jsonb_build_object\([\s\S]+?::text\)/i);
    expect(migration).toMatch(/'status', 'payload_too_large', 'reason', 'compaction_required'/i);
  });

  it('exposes the RPC only to authenticated callers and service role', () => {
    expect(migration).toMatch(/revoke all on function[\s\S]+from public, anon/i);
    expect(migration).toMatch(/grant execute on function[\s\S]+to authenticated, service_role/i);
  });
});
