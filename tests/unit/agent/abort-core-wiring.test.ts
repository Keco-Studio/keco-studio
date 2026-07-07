import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const coreSource = readFileSync(path.join(process.cwd(), 'src/lib/agent/core.ts'), 'utf8');
const routeSource = readFileSync(path.join(process.cwd(), 'src/app/api/agent-chat/route.ts'), 'utf8');

describe('agent abort signal wiring', () => {
  it('threads an AbortSignal from the route into the agent turn and LLM calls', () => {
    expect(routeSource).toContain('new AbortController()');
    expect(routeSource).toContain('abortController.signal');
    expect(coreSource).toContain('signal?: AbortSignal');
    expect(coreSource).toMatch(/streamLlm\([^)]*\{[\s\S]*signal/);
  });

  it('checks for aborts before starting iterations and tool execution', () => {
    expect(coreSource).toContain('throwIfAborted');
    expect(coreSource).toContain('input.signal');
    expect(coreSource).toMatch(/throwIfAborted\([^)]*signal[^)]*\)[\s\S]*const llmMessages/);
    expect(coreSource).toMatch(/throwIfAborted\([^)]*signal[^)]*\)[\s\S]*tool\.execute/);
  });
});
