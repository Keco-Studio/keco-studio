import { describe, expect, it } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();

describe('Script dialogue derived table synchronization', () => {
  it('prepares sibling table operations before the atomic document replacement', () => {
    const source = readFileSync(
      resolve(root, 'src/lib/server/scriptDialogueDocumentSyncService.ts'),
      'utf8',
    );

    expect(source).toContain('prepareScriptDialogueDerivedTableOperations');
    expect(source).toContain("const derivedTableOperations = input.command.type === 'reorder'");
    expect(source).toContain(': await prepareScriptDialogueDerivedTableOperations({');
    expect(source).toContain('derivedTableOperations.length > 0 ? { derivedTableOperations }');
    expect(source).not.toContain('syncScriptDialogueDerivedTables');
  });

  it('provides a semantic command planner for sibling table rows', () => {
    const plannerPath = resolve(
      root,
      'src/lib/script-system/scriptDialogueDerivedTableSync.ts',
    );

    expect(existsSync(plannerPath)).toBe(true);
    const source = existsSync(plannerPath) ? readFileSync(plannerPath, 'utf8') : '';
    expect(source).toContain('export function planDerivedDialogueCommand');
    expect(source).toContain("command.type === 'insert'");
    expect(source).toContain('sourceTextForDialogueBlock');
  });

  it('defines one transaction RPC for the document and every derived table mutation', () => {
    const migrationPath = resolve(
      root,
      'supabase/migrations/20260814090000_atomic_script_dialogue_document_table_sync.sql',
    );

    expect(existsSync(migrationPath)).toBe(true);
    const source = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';
    expect(source).toContain('replace_document_with_markdown_and_sync_tables');
    expect(source).toContain('perform public.replace_document_with_markdown(');
    expect(source).toContain('p_derived_table_operations jsonb');
    expect(source).toContain("v_operation ->> 'insertAtStart'");
    expect(source).not.toContain('v_operation_count <> v_expected_table_count');
    expect(source).toMatch(/grant execute[\s\S]+to service_role/i);
    expect(source).not.toMatch(/grant execute[\s\S]+to authenticated/i);
  });

  it('accepts Type 3 rows when editing narration or action content', () => {
    const migrationPath = resolve(
      root,
      'supabase/migrations/20260814090000_atomic_script_dialogue_document_table_sync.sql',
    );
    const source = readFileSync(migrationPath, 'utf8');

    expect(source).toContain(
      "v_operation_type = 'edit' and v_speech_type not in ('1', '2', '3')",
    );

    const upgradePath = resolve(
      root,
      'supabase/migrations/20260817183000_allow_type3_atomic_script_table_edits.sql',
    );
    expect(existsSync(upgradePath)).toBe(true);
    const upgrade = existsSync(upgradePath) ? readFileSync(upgradePath, 'utf8') : '';
    expect(upgrade).toContain('pg_get_functiondef');
    expect(upgrade).toContain("v_speech_type not in ('1', '2', '3')");
    expect(upgrade).toContain('v_operation_count <> v_expected_table_count');
  });

  it('allows a Table-origin transaction to include the linked Conversation', () => {
    const migrationPath = resolve(
      root,
      'supabase/migrations/20260814090000_atomic_script_dialogue_document_table_sync.sql',
    );
    expect(readFileSync(migrationPath, 'utf8')).toContain(
      "library.document_export_type in ('table', 'script')",
    );

    const upgradePath = resolve(
      root,
      'supabase/migrations/20260817190000_allow_script_conversation_atomic_table_edits.sql',
    );
    expect(existsSync(upgradePath)).toBe(true);
    expect(readFileSync(upgradePath, 'utf8')).toContain(
      "library.document_export_type in ('table', 'script')",
    );
  });
});
