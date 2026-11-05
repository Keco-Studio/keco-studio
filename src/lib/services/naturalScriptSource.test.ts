import { naturalScriptSource, naturalChoiceLabels } from './naturalScriptSource';

it('does not erase a title without a matching author profile block', () => {
  expect(naturalScriptSource('\u4eba\u7269\u8d44\u6599\n\u5411\u5bfc: \u6b22\u8fce。')).toBe('\u4eba\u7269\u8d44\u6599\n\u5411\u5bfc: \u6b22\u8fce。');
});

it('does not trim an unquoted standard speaker name ending in a reporting verb', () => {
  expect(naturalScriptSource('\u674e\u8bf4: \u4f60\u597d。')).toBe('\u674e\u8bf4: \u4f60\u597d。');
  expect(naturalScriptSource('\u674e\u8bf4：“\u4f60\u597d。”')).toBe('\u674e: \u4f60\u597d。');
});

it('recognizes explicit option declarations only when there are multiple labels', () => {
  expect(naturalChoiceLabels('\u8fd9\u91cc\u8ba9\u73a9\u5bb6\u9009\u62e9：\u8d70 / \u7b49。')).toEqual(['\u8d70', '\u7b49']);
  expect(naturalChoiceLabels('\u73a9\u5bb6\u9009\u62e9：\u6211\u60f3\u8d70。')).toEqual([]);
});
