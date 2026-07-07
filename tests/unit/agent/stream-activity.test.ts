import { describe, expect, it } from '@jest/globals';
import { formatElapsedSeconds, streamActivityLabel } from '../../../src/components/agent/streamActivity';

describe('streamActivity', () => {
  it('maps activity phases to user-visible labels', () => {
    expect(streamActivityLabel('connecting')).toBe('Connecting…');
    expect(streamActivityLabel('thinking')).toBe('Thinking…');
    expect(streamActivityLabel('tool')).toBe('Running tool…');
  });

  it('formats elapsed seconds for the activity bar', () => {
    const start = Date.now() - 65_000;
    expect(formatElapsedSeconds(start, start + 65_000)).toBe('1m 5s');
    expect(formatElapsedSeconds(start, start + 12_000)).toBe('12s');
  });
});
