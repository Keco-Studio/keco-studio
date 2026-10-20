import type { ToolContext } from '@/lib/agent/types';
import { prepareScriptDialogueAction, executeScriptDialogueAction } from '@/lib/agent/script-dialogue-mutation-tool-service';
import { editScriptDialogueTool, changeScriptDialogueSpeakerTool } from '@/lib/agent/tools/edit-script-dialogue';

jest.mock('@/lib/agent/script-dialogue-mutation-tool-service', () => ({
  prepareScriptDialogueAction: jest.fn(), executeScriptDialogueAction: jest.fn(),
}));

const ctx = { userId: 'actor' } as ToolContext;
const args = { libraryId: 'library', blockId: 'block', idempotencyKey: 'key' };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(prepareScriptDialogueAction).mockResolvedValue({ success: true, args, preview: {} });
  jest.mocked(executeScriptDialogueAction).mockResolvedValue({ success: true, data: { operationId: 'key' } });
});

it.each([
  ['edit', editScriptDialogueTool],
  ['speaker', changeScriptDialogueSpeakerTool],
] as const)('routes %s through the receipt-backed transaction', async (kind, tool) => {
  expect(tool.confirmationPolicy).toBe('always');
  expect(tool.parameters.required).toContain('idempotencyKey');
  await tool.prepareConfirmation!(args, ctx);
  expect(prepareScriptDialogueAction).toHaveBeenCalledWith(kind, args, ctx);
  expect(await tool.execute(args, ctx)).toMatchObject({ success: true, data: { operationId: 'key' } });
  expect(executeScriptDialogueAction).toHaveBeenCalledWith(kind, args, ctx);
});
