import {
  formatReasoningSeconds,
  reasoningDurationLabel,
  reasoningLabel,
  summarizeReasoning,
} from '../../../src/components/agent/reasoning-utils';

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

  it('uses the latest meaningful reasoning sentence as the summary', () => {
    expect(summarizeReasoning('先检查数据。\n\n**正在比较字段差异**')).toBe('正在比较字段差异');
  });

  it('removes markdown markers and truncates long summaries', () => {
    expect(summarizeReasoning('- **检查权限配置**')).toBe('检查权限配置');
    expect(summarizeReasoning('这是一个非常长的思考内容，需要限制折叠标题的显示长度。', 12))
      .toBe('这是一个非常长的思考内容…');
  });

  it('returns an empty summary for whitespace and punctuation only', () => {
    expect(summarizeReasoning('  \n --- ')).toBe('');
  });

  it('formats duration separately from the summary', () => {
    expect(reasoningDurationLabel(1_000, undefined, 4_500)).toBe('4s');
    expect(reasoningDurationLabel(1_000, 4_000, 9_000)).toBe('3s');
  });
});
