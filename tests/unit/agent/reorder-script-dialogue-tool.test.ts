import type { ToolContext } from '@/lib/agent/types';
import { prepareScriptDialogueAction, executeScriptDialogueAction } from '@/lib/agent/script-dialogue-mutation-tool-service';
import { reorderScriptDialogueTool } from '@/lib/agent/tools/reorder-script-dialogue';

jest.mock('@/lib/agent/script-dialogue-mutation-tool-service', () => ({
  prepareScriptDialogueAction: jest.fn(), executeScriptDialogueAction: jest.fn(),
}));

it('routes reorder through the receipt-backed transaction', async () => {
  const ctx = { userId: 'actor' } as ToolContext;
  const args = { libraryId: 'library', movingBlockId: 'first', targetBlockId: 'second', idempotencyKey: 'key' };
  jest.mocked(prepareScriptDialogueAction).mockResolvedValue({ success: true, args, preview: {} });
  jest.mocked(executeScriptDialogueAction).mockResolvedValue({ success: true, data: { operationId: 'key' } });
  expect(reorderScriptDialogueTool.confirmationPolicy).toBe('always');
  expect(reorderScriptDialogueTool.parameters.required).toContain('idempotencyKey');
  await reorderScriptDialogueTool.prepareConfirmation!(args, ctx);
  expect(prepareScriptDialogueAction).toHaveBeenCalledWith('reorder', args, ctx);
  expect(await reorderScriptDialogueTool.execute(args, ctx)).toMatchObject({ success: true, data: { operationId: 'key' } });
  expect(executeScriptDialogueAction).toHaveBeenCalledWith('reorder', args, ctx);
});
