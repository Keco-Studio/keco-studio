import { buildConvertedScriptSource } from './convertedScriptSource';
import { listScriptSourceBlocks } from './scriptDocumentBlocks';
import { replaceScriptSourceBlock } from './scriptDocumentBlocks';
import { toScriptImportPlainText } from '@/lib/documents/scriptImportPlainText';

it('persists actual bold and italic formatting, preserving it after visual edits and reimport', () => {
  const source = buildConvertedScriptSource('', '**\u7b2c\u4e00\u5e55 - \u65e7\u706f\u5854**\n*\u65f6\u95f4: \u508d\u665a*\n\u5b88\u5854\u4eba: \u4f60\u7ec8\u4e8e\u6765\u4e86.');
  expect(source).toContain('**\u7b2c\u4e00\u5e55 - \u65e7\u706f\u5854**');
  expect(source).toContain('*\u65f6\u95f4: \u508d\u665a*');
  expect(source).not.toContain('\\*');
  const blocks = listScriptSourceBlocks(source);
  expect(blocks.map(b => b.text)).toEqual(['\u7b2c\u4e00\u5e55 - \u65e7\u706f\u5854', '\u65f6\u95f4: \u508d\u665a', '\u5b88\u5854\u4eba: \u4f60\u7ec8\u4e8e\u6765\u4e86.']);
  const edited = replaceScriptSourceBlock(source, blocks[1].blockId, '\u65f6\u95f4: \u6df1\u591c');
  expect(edited).toContain('*\u65f6\u95f4: \u6df1\u591c*');
  expect(toScriptImportPlainText(edited)).toContain('**\u7b2c\u4e00\u5e55 - \u65e7\u706f\u5854**');
  expect(toScriptImportPlainText(edited)).toContain('*\u65f6\u95f4: \u6df1\u591c*');
});

it('updates source syntax and retains the anchors used by dialogue and flow editing', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const source = `<BlockAnchor id="${id}" />\u5411\u5bfc：\u53bb\u54ea？`;
  const result = listScriptSourceBlocks(buildConvertedScriptSource(source,
    '\u5411\u5bfc: "\u53bb\u54ea？"\nO1: \u6cb3\u8fb9 (jump O1)\nO1 branch [O1 | \u6cb3\u8fb9]\n\u65c5\u884c\u8005: "\u51fa\u53d1。"'));
  expect(result.map(b => b.text)).toEqual(['\u5411\u5bfc: "\u53bb\u54ea？"', 'O1: \u6cb3\u8fb9 (jump O1)', 'O1 branch [O1 | \u6cb3\u8fb9]', '\u65c5\u884c\u8005: "\u51fa\u53d1。"']);
  expect(result[0].blockId).toBe(id);
  expect(new Set(result.map(b => b.blockId)).size).toBe(4);
});
