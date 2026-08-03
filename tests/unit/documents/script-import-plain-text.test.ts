import { toScriptImportPlainText } from '@/lib/documents/scriptImportPlainText';

describe('toScriptImportPlainText', () => {
  it('strips BlockAnchor markers and keeps dialogue', () => {
    const input = [
      '<BlockAnchor id="abea649c-7d05-43e1-87ff-c9c4e13b0dd3" />General: He has gone mad.',
      '<BlockAnchor id="82a70c59-7d05-43e1-87ff-c9c4e13b0dd3" />Heroine: Are you coming with me?',
      '<BlockAnchor id="5a5d1f14-7d05-43e1-87ff-c9c4e13b0dd3" />General: I will take the vanguard.&#x20;',
    ].join('\n');

    expect(toScriptImportPlainText(input)).toBe(
      [
        'General: He has gone mad.',
        'Heroine: Are you coming with me?',
        'General: I will take the vanguard.',
      ].join('\n')
    );
  });

  it('replaces ResourceReference with fallbackLabel', () => {
    expect(
      toScriptImportPlainText(
        'See <ResourceReference kind="table-row" libraryId="11111111-1111-4111-8111-111111111111" assetId="22222222-2222-4222-8222-222222222222" displayFieldId="33333333-3333-4333-8333-333333333333" fallbackLabel="Ada" />.'
      )
    ).toBe('See Ada.');
  });

  it('normalizes escaped Markdown screenplay lines into importable text', () => {
    const input = [
      '\\### 【\u5f00\u573a\u5bf9\u8bdd】',
      '',
      '\\*\\*\u5973\u5e1d\\*\\*（\u672a\u56de\u5934）：\u6c99\u66b4\u5c01\u4e86\u9000\u8def。',
      '',
      '\\- \\*\\*\u4f60\\*\\*：\u81e3\u8bf7\u79fb\u5e10。',
      '',
      '\\> \\*\\*“\u5171\u996e\u52ff\u4e89。”\\*\\*',
    ].join('\n');

    expect(toScriptImportPlainText(input)).toBe([
      '【\u5f00\u573a\u5bf9\u8bdd】',
      '',
      '\u5973\u5e1d（\u672a\u56de\u5934）：\u6c99\u66b4\u5c01\u4e86\u9000\u8def。',
      '',
      '\u4f60：\u81e3\u8bf7\u79fb\u5e10。',
      '',
      '“\u5171\u996e\u52ff\u4e89。”',
    ].join('\n'));
  });
});
