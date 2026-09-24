import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const hookSource = readFileSync(
  path.join(process.cwd(), 'src/components/agent/useAgentChat.ts'),
  'utf8'
);
const panelSource = readFileSync(
  path.join(process.cwd(), 'src/components/agent/ChatPanel.tsx'),
  'utf8'
);

describe('agent conversation switch lifecycle wiring', () => {
  it('does not abort an active Agent turn when changing the visible conversation', () => {
    const loadConversationBlock =
      hookSource.match(/const loadConversation[\s\S]*?const restoreScopedConversation/)?.[0] ?? '';
    const restoreScopedConversationBlock =
      hookSource.match(/const restoreScopedConversation[\s\S]*?useEffect\(/)?.[0] ?? '';
    const startNewConversationBlock =
      hookSource.match(/const startNewConversation[\s\S]*?const loadConversation/)?.[0] ?? '';

    expect(loadConversationBlock).not.toContain('stopStreaming(');
    expect(loadConversationBlock).not.toContain('streamAbortRef');
    expect(restoreScopedConversationBlock).not.toContain('stopStreaming(');
    expect(restoreScopedConversationBlock).not.toContain('streamAbortRef');
    expect(startNewConversationBlock).not.toContain('stopStreaming(');
    expect(startNewConversationBlock).not.toContain('streamAbortRef');
    expect(hookSource).toContain('getScopedAgentRuntime(runtimeScope)');
  });

  it('routes send and confirmation streams through their originating runtime key', () => {
    expect(hookSource).toMatch(/consumeStream\(\s*response,\s*requestRuntimeKey/g);
    expect(hookSource).toContain('updateAgentChatRuntime(requestRuntimeKey');
  });

  it('guards history loading and stale project restores', () => {
    expect(hookSource).toContain('isLoading: true');
    expect(hookSource).toContain('restoreEpochRef.current');
    expect(hookSource).toContain('if (!open || !ctx.userId) return false;');
    expect(hookSource).toContain('if (!open || !ctx.userId) return;');
    expect(hookSource).toContain('if (selectedRuntime?.conversationId || selectedRuntime?.isStreaming ||');
    expect(hookSource).toContain('[ctx.userId, ctx.workspace, ctx.projectId]');
    expect(panelSource).toContain('useAgentChat(ctx, open)');
    expect(panelSource).toContain('{showHistory && (');
  });

  it('blocks anonymous turns until the authenticated profile is ready', () => {
    expect(hookSource).toMatch(/if \(\s*!ctx\.userId/);
    expect(panelSource).toContain('if (!projectId || !userProfile?.id) return;');
  });

  it('invalidates pending automatic restores when the user selects New or History', () => {
    expect(hookSource).toMatch(
      /const startNewConversation[\s\S]*restoreEpochRef\.current \+= 1/
    );
    expect(hookSource).toMatch(
      /const loadConversation[\s\S]*restoreEpochRef\.current \+= 1/
    );
  });
});
