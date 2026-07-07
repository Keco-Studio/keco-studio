import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const coreSource = readFileSync(path.join(process.cwd(), 'src/lib/agent/core.ts'), 'utf8');

describe('agent turn budget core wiring', () => {
  it('passes an explicit maxTokens value to every LLM completion', () => {
    expect(coreSource).toContain('AGENT_LLM_MAX_TOKENS');
    expect(coreSource).toMatch(/streamLlm\([^)]*\{[\s\S]*maxTokens:\s*AGENT_LLM_MAX_TOKENS/);
  });

  it('checks the per-turn token budget between ReAct iterations', () => {
    expect(coreSource).toContain('isOverTokenBudget');
    expect(coreSource).toContain('tokenBudgetExceededMessage');
    expect(coreSource).toContain('addTokenUsageTotal');
  });

  it('persists and resumes the next iteration counter across confirmations', () => {
    expect(coreSource).toContain('nextIteration: iterations');
    expect(coreSource).toMatch(/pending\.suspendedState\.nextIteration\s*\?\?/);
    expect(coreSource).not.toContain('continueLoop(messages, toolContext, meta, conversationId, 0, trace)');
  });

  it('compacts historical and next-iteration user content', () => {
    expect(coreSource).toContain('compactLargeUserContentInMessages');
    expect(coreSource).toContain('const compactedHistory = compactLargeUserContentInMessages(history)');
  });
});
