import { createHash } from 'node:crypto';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import { mapReferenceAttachmentRecord } from '../map-reference-attachment';
import { requireProjectContext } from '../workspace';
import type { AgentTool, ToolContext, ToolResult } from '../types';

const publicErrors = new Set([
  'Attach a Map reference image to the current message first.',
  'Editor or admin access is required.',
  'Conversation project binding is invalid.',
  'Map reference attachment is not bound to this user message.',
  'Map reference bytes failed verification.',
  'This Map reference submission was already used.',
  'Invalid map reference image.',
]);

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  if (!params || typeof params !== 'object' || Array.isArray(params)
    || Object.keys(params).length !== 0) {
    return { success: false, error: 'Map reference upload accepts no source arguments.' };
  }
  const source = ctx.authoritativeMapReference;
  if (ctx.workspace !== 'create-map' || !source
    || source.messageId !== ctx.authoritativeUserSource?.messageId) {
    return { success: false, error: 'Attach a Map reference image to the current message first.' };
  }
  try {
    const projectId = requireProjectContext(ctx);
    const role = (await getUserProjectRole(ctx.supabase, projectId, ctx.userId)).role;
    if (role !== 'admin' && role !== 'editor') throw new Error('Editor or admin access is required.');

    const { data: conversation, error: conversationError } = await ctx.supabase
      .from('agent_conversations').select('id,user_id,project_id')
      .eq('id', ctx.conversationId).maybeSingle();
    if (conversationError || !conversation || conversation.user_id !== ctx.userId
      || conversation.project_id !== projectId) throw new Error('Conversation project binding is invalid.');

    const { data: message, error: messageError } = await ctx.supabase
      .from('agent_messages').select('id,role,content')
      .eq('id', source.messageId).eq('conversation_id', ctx.conversationId).maybeSingle();
    const content = message?.content as Record<string, unknown> | null;
    const persisted = content?.map_reference_attachment;
    const expected = mapReferenceAttachmentRecord(source);
    if (messageError || !message || message.role !== 'user'
      || content?.map_reference_submission_id !== source.submissionId
      || !persisted || typeof persisted !== 'object' || Array.isArray(persisted)
      || Object.keys(persisted).length !== Object.keys(expected).length
      || Object.keys(expected).some((key) =>
        (persisted as Record<string, unknown>)[key] !== expected[key as keyof typeof expected])) {
      throw new Error('Map reference attachment is not bound to this user message.');
    }
    if (source.bytes.byteLength !== source.fileSize || digest(source.bytes) !== source.sha256
      || digest(source.normalizedBytes) !== source.normalizedSha256) {
      throw new Error('Map reference bytes failed verification.');
    }

    const { data: consumed, error: consumeError } = await ctx.supabase.rpc(
      'consume_agent_map_reference_submission', {
        p_submission_id: source.submissionId, p_message_id: source.messageId,
        p_project_id: projectId, p_conversation_id: ctx.conversationId,
        p_sha256: source.sha256,
      }
    );
    if (consumeError || consumed !== true) throw new Error('This Map reference submission was already used.');

    const { uploadCreateMapReference } = await import('@/lib/server/createMapReferenceService');
    const file = new File([new Uint8Array(source.bytes)], source.fileName, { type: source.mimeType });
    const reference = await uploadCreateMapReference(projectId, file, ctx.userId, {
      bytes: Buffer.from(source.normalizedBytes), width: source.width,
      height: source.height, sha256: source.normalizedSha256,
    });
    return { success: true, displayHint: 'map', data: {
      assetId: reference.id, projectId, name: reference.name,
      sha256: reference.sha256, width: reference.width, height: reference.height,
    }, invalidations: [{ type: 'create-map', projectId }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (publicErrors.has(message)) return { success: false, error: message };
    if (error && typeof error === 'object' && 'code' in error
      && typeof error.code === 'string' && error.code.startsWith('invalid_reference_')) {
      return { success: false, error: 'Invalid map reference image.' };
    }
    return { success: false, error: 'Map reference upload failed.' };
  }
}

export const uploadMapReferenceTool: AgentTool = {
  name: 'upload_map_reference',
  description: 'Upload the actual Map reference image attached to the current user message. Accepts no model-supplied path, URL, or bytes.',
  category: 'write', confirmationMode: 'pre_execute', confirmationRequired: false,
  requiredPermission: 'editor',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  execute,
};
