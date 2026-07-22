import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(
  path.resolve(__dirname, '../../../supabase/migrations/20260722010000_mcp_read_search_telemetry.sql'),
  'utf8'
);

describe('MCP read, search, and telemetry migration', () => {
  it('creates private fixed-window rate and append-only audit storage', () => {
    expect(migration).toMatch(/create table public\.mcp_rate_limit_buckets/i);
    expect(migration).toMatch(/primary key \(actor_id, project_id, operation_class, window_started_at\)/i);
    expect(migration).toMatch(/create table public\.mcp_audit_events/i);
    expect(migration).toMatch(
      /create unique index mcp_audit_operation_event_unique[\s\S]+\(operation_id, event_type\)/i
    );
    expect(migration).toMatch(/create trigger mcp_audit_events_append_only/i);
    expect(migration).toMatch(/revoke all on table public\.mcp_audit_events from public, anon, authenticated/i);
  });

  it('admits at most one completion per operation atomically', () => {
    expect(migration).toMatch(
      /on conflict \(operation_id, event_type\) do nothing[\s\S]+if not found then[\s\S]+already complete/i
    );
  });

  it('enforces exact operation class limits atomically', () => {
    expect(migration).toMatch(/when 'static' then 240/i);
    expect(migration).toMatch(/when 'read' then 120/i);
    expect(migration).toMatch(/when 'write' then 30/i);
    expect(migration).toMatch(/when 'search' then 20/i);
    expect(migration).toMatch(/on conflict \(actor_id, project_id, operation_class, window_started_at\)[\s\S]+request_count < v_limit/i);
  });

  it('derives identity and exposes only bounded project reads', () => {
    expect(migration).toMatch(/v_actor uuid := \(select auth\.uid\(\)\)/i);
    expect(migration).toMatch(/create or replace function public\.mcp_read_project_structure/i);
    expect(migration).toMatch(/order by d\.updated_at desc, d\.id desc limit 200/i);
    expect(migration).toMatch(/create index if not exists idx_documents_project_updated_id/i);
  });

  it('provides bounded semantic search without chat and text fallback', () => {
    expect(migration).toMatch(/create or replace function public\.mcp_vector_search/i);
    expect(migration).toMatch(/source_type in \('library_cell', 'library_row', 'library_schema',[\s\S]+'project_document'\)/i);
    expect(migration).not.toMatch(/mcp_vector_search[\s\S]+source_type in \([^)]*chat_message/i);
    expect(migration).toMatch(/create or replace function public\.mcp_text_search/i);
    expect(migration).toMatch(/plainto_tsquery/i);
    expect(migration).toMatch(/extensions\.similarity/i);
  });

  it('limits cleanup to service role with 90-day audit retention', () => {
    expect(migration).toMatch(/created_at < pg_catalog\.clock_timestamp\(\) - interval '90 days'/i);
    expect(migration).toMatch(/revoke all on function public\.mcp_cleanup_telemetry\(\) from public, anon, authenticated/i);
    expect(migration).toMatch(/grant execute on function public\.mcp_cleanup_telemetry\(\) to service_role/i);
  });
});
