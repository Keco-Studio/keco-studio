import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/script-system/useScriptDialogueEditor.ts'),
  'utf8',
);

describe('Script dialogue editor performance wiring', () => {
  it('uses atomic dialogue RPCs and immediate asset cache updates', () => {
    expect(source).toContain('insertScriptDialogueBlock({');
    expect(source).toContain('deleteScriptDialogueBlock({');
    expect(source).toContain('queryClient.setQueryData<AssetRow[]>(');
    expect(source).toContain('applyInsertedDialogueRows');
    expect(source).toContain('removeDeletedDialogueRows');
  });

  it('schedules successful mutation reconciliation without awaiting it', () => {
    expect(source).toContain('void refresh();');
    expect(source).toContain('if (usedLegacyMutation) await refresh();\n      else void refresh();');
  });

  it('uses the dialogue block id as the stable source-document anchor', () => {
    expect(source).toContain('blockId: block.id');
    expect(source).not.toContain('blockId: globalThis.crypto.randomUUID()');
  });

  it('updates saved dialogue in cache before background reconciliation', () => {
    expect(source).toContain('applySavedDialogueContent');
    expect(source).toContain('void refresh();\n      return true;');
  });

  it('saves a complete dialogue block with one source sync and parallel row writes', () => {
    expect(source).toContain('const saveBlock = useCallback(async (');
    expect(source).toContain('previousDialogue: block.dialogue');
    expect(source).toContain('updateDialogueRowsContent({');
    expect(source).toContain('const [, completedUpdates] = await Promise.all([');
    expect(source).not.toContain('const saveBlockField = useCallback(async (');
  });

  it('falls back to legacy mutations while the RPC migration is not deployed', () => {
    expect(source).toContain('isMissingScriptDialogueRpcError');
    expect(source).toContain('insertDialogueThreadAfter({');
    expect(source).toContain('deleteDialogueBlock({');
  });
});
