import type { ToolCall } from '@/lib/agent/types';
import { normalizeToolCallForReplay } from '@/lib/agent/tool-call-recovery';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function toolCall(argumentsText: string): ToolCall {
  return {
    id: 'call-long-import',
    type: 'function',
    function: {
      name: 'propose_document_edit',
      arguments: argumentsText,
    },
  };
}

describe('tool call replay recovery', () => {
  it('replaces truncated arguments with a valid empty JSON object', () => {
    const malformed = toolCall('{"operation":{"type":"append","content":"truncated');

    expect(normalizeToolCallForReplay(malformed)).toEqual({
      ...malformed,
      function: { ...malformed.function, arguments: '{}' },
    });
  });

  it('returns valid object arguments without changing the tool call', () => {
    const valid = toolCall('{"operation":{"type":"append_user_source"}}');

    expect(normalizeToolCallForReplay(valid)).toBe(valid);
  });

  it.each(['[]', 'null', '"text"', ''])('normalizes non-object arguments %p', (raw) => {
    expect(normalizeToolCallForReplay(toolCall(raw)).function.arguments).toBe('{}');
  });

  it('normalizes every assistant tool call before it can enter conversation history', () => {
    const core = readFileSync(path.join(process.cwd(), 'src/lib/agent/core.ts'), 'utf8');

    expect(core).toContain('tool_calls: [normalizeToolCallForReplay(call)]');
  });
});
