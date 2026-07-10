import { describe, expect, it, jest } from '@jest/globals';
import type { AgentTool, ToolContext, ToolResult } from '@/lib/agent/types';
import { executeAgentTool } from '@/lib/agent/tool-execution-stream';

describe('streamed agent tool execution', () => {
  it('forwards progress events and preserves the final tool result', async () => {
    const finalResult: ToolResult = { success: true, data: { libraryId: 'lib-1' } };
    const tool = {
      execute: jest.fn(),
      async *executeStream() {
        yield { phase: 'conversion' as const, message: 'Converting' };
        yield { phase: 'semantic_audit' as const, message: 'Auditing' };
        return finalResult;
      },
    } as unknown as AgentTool;

    const iterator = executeAgentTool(tool, {}, {} as ToolContext);
    expect(await iterator.next()).toEqual({
      done: false,
      value: { phase: 'conversion', message: 'Converting' },
    });
    expect(await iterator.next()).toEqual({
      done: false,
      value: { phase: 'semantic_audit', message: 'Auditing' },
    });
    expect(await iterator.next()).toEqual({ done: true, value: finalResult });
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it('falls back to the ordinary execute method', async () => {
    const finalResult: ToolResult = { success: true, data: 'done' };
    const tool = { execute: jest.fn(async () => finalResult) } as unknown as AgentTool;
    const iterator = executeAgentTool(tool, {}, {} as ToolContext);

    expect(await iterator.next()).toEqual({ done: true, value: finalResult });
    expect(tool.execute).toHaveBeenCalledTimes(1);
  });
});
