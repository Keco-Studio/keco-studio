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
      '\\### 【Opening dialogue】',
      '',
      '\\*\\*Empress\\*\\*（without turning）：The sandstorm sealed the retreat.',
      '',
      '\\- \\*\\*You\\*\\*：I request to move the camp.',
      '',
      '\\> \\*\\*“Share the wine, do not quarrel.”\\*\\*',
    ].join('\n');

    expect(toScriptImportPlainText(input)).toBe([
      '【Opening dialogue】',
      '',
      'Empress（without turning）：The sandstorm sealed the retreat.',
      '',
      'You：I request to move the camp.',
      '',
      '“Share the wine, do not quarrel.”',
    ].join('\n'));
  });
});
