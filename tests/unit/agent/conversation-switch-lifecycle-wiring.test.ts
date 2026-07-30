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
      hookSource.match(/const loadConversation[\s\S]*?\n\s*\},\n\s*\[getToken[\s\S]*?\]\n\s*\);/)?.[0] ?? '';
    const restoreProjectConversationBlock =
      hookSource.match(
        /const restoreProjectConversation[\s\S]*?\n\s*\},\s*\[ctx\.userId,\s*ctx\.projectId,\s*loadConversation,\s*resetToEmpty,\s*activateRuntime\]\s*\);/
      )?.[0] ?? '';
    const startNewConversationBlock =
      hookSource.match(/const startNewConversation[\s\S]*?\n\s*\},\s*\[resetToEmpty,\s*ctx\.userId,\s*ctx\.projectId\]\s*\);/)?.[0] ?? '';

    expect(loadConversationBlock).not.toContain('stopStreaming(');
    expect(loadConversationBlock).not.toContain('streamAbortRef');
    expect(restoreProjectConversationBlock).not.toContain('stopStreaming(');
    expect(restoreProjectConversationBlock).not.toContain('streamAbortRef');
    expect(startNewConversationBlock).not.toContain('stopStreaming(');
    expect(startNewConversationBlock).not.toContain('streamAbortRef');
    expect(hookSource).toContain('getProjectAgentRuntime(ctx.userId, ctx.projectId)');
  });

  it('routes send and confirmation streams through their originating runtime key', () => {
    expect(hookSource).toMatch(/consumeStream\(\s*response,\s*requestRuntimeKey/g);
    expect(hookSource).toContain('updateAgentChatRuntime(requestRuntimeKey');
  });

  it('guards history loading and stale project restores', () => {
    expect(hookSource).toContain('isLoading: true');
    expect(hookSource).toContain('restoreEpochRef.current');
  });

  it('blocks anonymous turns until the authenticated profile is ready', () => {
    expect(hookSource).toMatch(/if \(\s*!ctx\.userId/);
    expect(panelSource).toContain('if (!currentProjectId || !userProfile?.id) return;');
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
