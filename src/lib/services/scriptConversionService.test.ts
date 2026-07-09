import { describe, expect, it } from '@jest/globals';
import {
  canImportScriptDirectly,
  looksLikeStructuredScript,
} from './scriptConversionService';

describe('scriptConversionService structured detection', () => {
  it('does not treat prose with an incidental colon as structured script', () => {
    const prose = '备注: 今天很热，街上的风也慢了下来。她没有立刻回答，只是看向窗外。';

    expect(looksLikeStructuredScript(prose)).toBe(false);
    expect(canImportScriptDirectly(prose)).toBe(false);
  });

  it.each([
    '【Start｜午后，狭小公寓】',
    '（Type1・阿塔那）你好世界',
    'O1：留下来',
    'O1 branch【O1｜分支场景】',
    '（Jump Oend）',
    '- 追上去',
    '[Label]',
  ])('recognizes standard script marker: %s', (source) => {
    expect(looksLikeStructuredScript(source)).toBe(true);
  });
});
