import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const coreSource = fs.readFileSync(
  path.join(process.cwd(), 'src/lib/agent/core.ts'),
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
});
