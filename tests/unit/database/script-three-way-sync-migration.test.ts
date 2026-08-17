import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260817170000_script_three_way_sync.sql',
);

describe('Script three-way synchronization migration', () => {
  it('atomically replaces the document, reorders rows, and persists plot_plan', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('replace_document_with_markdown_and_reorder_script');
    expect(sql).toContain('p_script_library_id uuid');
    expect(sql).toContain('p_expected_order_ids uuid[]');
    expect(sql).toContain('p_next_order_ids uuid[]');
    expect(sql).toContain('p_plot_plan jsonb');
    expect(sql).toContain("jsonb_typeof(p_plot_plan) <> 'object'");
    expect(sql).toContain("library.document_export_type = 'script'");
    expect(sql).toContain('for update');
    expect(sql).toContain('PLOT_PLAN_ROW_ORDER_STALE');
    expect(sql).toContain('with ordinality');
    expect(sql).toContain('set plot_plan = p_plot_plan');
    expect(sql).toContain('perform public.replace_document_with_markdown(');
    expect(sql).toContain('revoke all on function public.replace_document_with_markdown_and_reorder_script');
    expect(sql).toContain('to service_role');
  });

  it('guards document-originated table reconciliation by document token', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('reconcile_script_library_from_document');
    expect(sql).toContain('p_expected_epoch bigint');
    expect(sql).toContain('p_expected_revision bigint');
    expect(sql).toContain("v_operation_type not in ('edit', 'insert', 'delete', 'reorder')");
    expect(sql).toContain("raise exception 'DOCUMENT_CONFLICT");
    expect(sql).toContain("v_operation -> 'expectedOrderIds'");
    expect(sql).toContain('row_id = any(v_expected_order_ids)');
    expect(sql).toContain("v_operation_type = 'insert'");
    expect(sql).toContain("v_operation_type = 'delete'");
    expect(sql).toContain('to service_role');
  });
});
