import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const coreSource = fs.readFileSync(
  path.join(process.cwd(), 'src/lib/agent/core.ts'),
  'utf8'
);
const chatSource = fs.readFileSync(
  path.join(process.cwd(), 'src/components/agent/useAgentChat.ts'),
  'utf8'
);
const cardSource = fs.readFileSync(
  path.join(process.cwd(), 'src/components/agent/ToolCallCard.tsx'),
  'utf8'
);

describe('Agent import source and progress wiring', () => {
  it('binds the persisted current user message as authoritative tool source', () => {
    expect(coreSource).toContain('const savedUserMessage = await saveMessage');
    expect(coreSource).toContain('authoritativeUserSource:');
    expect(coreSource).toContain('messageId: savedUserMessage.id');
    expect(coreSource).toContain('content: input.userMessage');
  });

  it('forwards streamed tool progress through SSE', () => {
    expect(coreSource).toContain("from './tool-execution-stream'");
    expect(coreSource).toContain("type: 'tool_progress'");
    expect(coreSource).toContain('yield* executeToolWithProgress');
  });

  it('updates the running tool card with streamed progress', () => {
    expect(chatSource).toContain("case 'tool_progress'");
    expect(chatSource).toContain('const progressMessage = String(progress?.message');
    expect(chatSource).toContain('toolCall: { ...item.toolCall, progressMessage }');
    expect(cardSource).toContain('toolCall.progressMessage');
  });

  it('forwards model reasoning_content when an assistant turn calls a tool', () => {
    expect(coreSource).toContain('let assistantReasoning =');
    expect(coreSource).toContain('assistantReasoning += chunk.content');
    expect(coreSource).toContain('reasoning_content: assistantReasoning');
  });
});
