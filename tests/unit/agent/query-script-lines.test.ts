import { describe, expect, it } from '@jest/globals';
import { getScriptOptionIndexes } from '@/lib/agent/tools/query-script-lines';

describe('query_script_lines dynamic options', () => {
  it('discovers option indexes numerically from dynamic field names', () => {
    expect(getScriptOptionIndexes([
      'Option10_Commands',
      'Option2_Next',
      'Content',
      'Option10',
      'Option2',
      'Option10_Next',
    ])).toEqual([2, 10]);
  });
});
