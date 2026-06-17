/**
 * set_conversation_option — toggle per-conversation options (meta confirmation).
 *
 * Sets autoExecute on the conversation. In Confirm mode the change itself requires
 * confirmation; in Auto mode meta confirmation is skipped.
 */

import { z } from 'zod';
import type { AgentTool, ToolContext, ToolResult } from '../types';
import { updateConversationMeta } from '../conversation-store';
import { metaForSave } from '../conversation-meta';

const ParamsSchema = z.object({
  option: z.enum(['autoExecute', 'skipConfirmation']),
  value: z.boolean(),
});

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }
  const { option, value } = parsed.data;

  const autoExecute = option === 'skipConfirmation' ? value : value;
  const saved = await updateConversationMeta(ctx.supabase, ctx.conversationId, metaForSave(autoExecute));

  return {
    success: true,
    displayHint: 'text',
    data: { option: 'autoExecute', value: autoExecute, meta: saved },
  };
}

export const setConversationOption: AgentTool = {
  name: 'set_conversation_option',
  description:
    'Toggle conversation execution mode. Use option="autoExecute" with value=true for immediate writes, value=false for step-by-step confirmation.',
  category: 'write',
  confirmationMode: 'meta',
  parameters: {
    type: 'object',
    properties: {
      option: {
        type: 'string',
        enum: ['autoExecute', 'skipConfirmation'],
        description: 'Prefer autoExecute; skipConfirmation is deprecated and maps to autoExecute',
      },
      value: { type: 'boolean', description: 'true = Auto (no confirmations), false = Confirm mode' },
    },
    required: ['option', 'value'],
  },
  execute,
};
