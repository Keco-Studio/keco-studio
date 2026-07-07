import { formatReasoningSeconds, reasoningLabel } from '../../../src/components/agent/reasoning-utils';

describe('reasoning-utils', () => {
  it('formats sub-minute durations in seconds', () => {
    expect(formatReasoningSeconds(500)).toBe('1s');
    expect(formatReasoningSeconds(3200)).toBe('3s');
  });

  it('formats minute durations', () => {
    expect(formatReasoningSeconds(65_000)).toBe('1m 5s');
    expect(formatReasoningSeconds(120_000)).toBe('2m');
  });

  it('shows in-progress and completed labels', () => {
    const start = 1_000;
    expect(reasoningLabel(start, undefined, true, 4_500)).toBe('Thinking (4s)');
    expect(reasoningLabel(start, 4_000, false, 9_000)).toBe('Thought for 3s');
  });
});
