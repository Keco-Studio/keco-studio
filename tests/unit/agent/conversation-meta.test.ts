import { describe, expect, it } from '@jest/globals';
import {
  needsConfirmation,
  resolveConversationMeta,
  executePostPreviewTool,
  metaForSave,
} from '../../../src/lib/agent/conversation-meta';
import type { AgentTool, ToolContext, ToolResult } from '../../../src/lib/agent/types';

function mockTool(overrides: Partial<AgentTool>): AgentTool {
  return {
    name: 'mock_tool',
    description: '',
    parameters: {},
    category: 'write',
    confirmationMode: 'pre_execute',
    execute: async () => ({ success: true }),
    ...overrides,
  };
}

describe('resolveConversationMeta', () => {
  it('defaults to autoExecute false when meta is empty', () => {
    expect(resolveConversationMeta({})).toEqual({ autoExecute: false });
    expect(resolveConversationMeta(null)).toEqual({ autoExecute: false });
    expect(resolveConversationMeta(undefined)).toEqual({ autoExecute: false });
  });

  it('preserves explicit autoExecute false', () => {
    expect(resolveConversationMeta({ autoExecute: false })).toEqual({ autoExecute: false });
  });

  it('maps legacy skipConfirmation true to autoExecute true', () => {
    expect(resolveConversationMeta({ skipConfirmation: true })).toEqual({ autoExecute: true });
  });

  it('prefers explicit autoExecute false over skipConfirmation', () => {
    expect(resolveConversationMeta({ autoExecute: false, skipConfirmation: true })).toEqual({
      autoExecute: false,
    });
  });

  it('passes through a bound scope verbatim', () => {
    const scope = { level: 'table' as const, projectId: 'p1', libraryId: 'l1' };
    expect(resolveConversationMeta({ autoExecute: true, scope })).toEqual({
      autoExecute: true,
      scope,
    });
  });

  it('omits scope for legacy rows without one', () => {
    expect(resolveConversationMeta({ autoExecute: false })).not.toHaveProperty('scope');
  });
});

describe('metaForSave', () => {
  it('writes autoExecute only when no scope is given', () => {
    expect(metaForSave(true)).toEqual({ autoExecute: true });
    expect(metaForSave(false)).toEqual({ autoExecute: false });
  });

  it('merges scope when provided', () => {
    const scope = { level: 'folder' as const, projectId: 'p1', folderId: 'f1' };
    expect(metaForSave(true, scope)).toEqual({ autoExecute: true, scope });
  });
});

describe('needsConfirmation', () => {
  it('never confirms read tools', () => {
    const read = mockTool({ category: 'read', confirmationMode: 'pre_execute' });
    expect(needsConfirmation(read, {})).toBe(false);
    expect(needsConfirmation(read, { autoExecute: false })).toBe(false);
  });

  it('skips confirmation for tools that complete their own validated write', () => {
    const validatedWrite = mockTool({ confirmationRequired: false });
    expect(needsConfirmation(validatedWrite, { autoExecute: false })).toBe(false);
  });

  it('lets mode-driven post-preview confirmation follow autoExecute', () => {
    const post = mockTool({
      confirmationMode: 'post_preview',
      confirmationPolicy: 'mode',
    });
    expect(needsConfirmation(post, { autoExecute: true })).toBe(false);
    expect(needsConfirmation(post, { autoExecute: false })).toBe(true);
  });

  it('requires always-confirm post-preview writes even when autoExecute is true', () => {
    const post = mockTool({
      confirmationMode: 'post_preview',
      confirmationPolicy: 'always',
    });
    expect(needsConfirmation(post, { autoExecute: true })).toBe(true);
  });

  it('requires confirmation for legacy post-preview writes in auto mode', () => {
    const post = mockTool({ confirmationMode: 'post_preview' });
    expect(needsConfirmation(post, { autoExecute: true })).toBe(true);
  });

  it('requires confirmation for meta writes even when autoExecute is true', () => {
    const metaTool = mockTool({ confirmationMode: 'meta' });
    expect(needsConfirmation(metaTool, { autoExecute: true })).toBe(true);
  });

  it('skips confirmation for pre_execute write tools when autoExecute is true', () => {
    const pre = mockTool({ confirmationMode: 'pre_execute' });
    expect(needsConfirmation(pre, { autoExecute: true })).toBe(false);
  });

  it('confirms post_preview and meta in requireConfirmation mode', () => {
    const post = mockTool({ confirmationMode: 'post_preview' });
    const metaTool = mockTool({ confirmationMode: 'meta' });
    expect(needsConfirmation(post, { autoExecute: false })).toBe(true);
    expect(needsConfirmation(metaTool, { autoExecute: false })).toBe(true);
  });

  it('confirms pre_execute by default in requireConfirmation mode', () => {
    const pre = mockTool({ confirmationMode: 'pre_execute' });
    expect(needsConfirmation(pre, { autoExecute: false })).toBe(true);
  });

  it('allows legacy skipConfirmation for pre_execute when autoExecute is false', () => {
    const pre = mockTool({ confirmationMode: 'pre_execute' });
    expect(needsConfirmation(pre, { skipConfirmation: true })).toBe(false);
  });
});

describe('executePostPreviewTool', () => {
  const ctx = {} as ToolContext;

  it('returns preview failure without calling executeImport', async () => {
    let importCalled = false;
    const tool = mockTool({
      confirmationMode: 'post_preview',
      execute: async () => ({ success: false, error: 'preview failed' }),
      executeImport: async () => {
        importCalled = true;
        return { success: true };
      },
    });

    const result = await executePostPreviewTool(tool, {}, ctx);
    expect(result.finalResult.success).toBe(false);
    expect(result.finalResult.error).toBe('preview failed');
    expect(importCalled).toBe(false);
  });

  it('runs executeImport after successful preview', async () => {
    const preview: ToolResult = { success: true, data: { preview: true }, displayHint: 'script_preview' };
    const imported: ToolResult = { success: true, data: { imported: true }, displayHint: 'text' };
    const tool = mockTool({
      confirmationMode: 'post_preview',
      execute: async () => preview,
      executeImport: async () => imported,
    });

    const result = await executePostPreviewTool(tool, { row: 1 }, ctx);
    expect(result.previewResult).toEqual(preview);
    expect(result.importResult).toEqual(imported);
    expect(result.finalResult).toEqual(imported);
  });

  it('treats tool without executeImport as single-phase', async () => {
    const preview: ToolResult = { success: true, data: { only: true } };
    const tool = mockTool({
      confirmationMode: 'post_preview',
      execute: async () => preview,
    });

    const result = await executePostPreviewTool(tool, {}, ctx);
    expect(result.finalResult).toEqual(preview);
    expect(result.importResult).toBeUndefined();
  });
});
