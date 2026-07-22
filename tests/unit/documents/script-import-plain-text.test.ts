import { toScriptImportPlainText } from '@/lib/documents/scriptImportPlainText';

describe('toScriptImportPlainText', () => {
  it('strips BlockAnchor markers and keeps dialogue', () => {
    const input = [
      '<BlockAnchor id="abea649c-7d05-43e1-87ff-c9c4e13b0dd3" />将军：疯了。',
      '<BlockAnchor id="82a70c59-7d05-43e1-87ff-c9c4e13b0dd3" />女主：你跟不跟我？',
      '<BlockAnchor id="5a5d1f14-7d05-43e1-87ff-c9c4e13b0dd3" />将军：末将，愿为先锋。&#x20;',
    ].join('\n');

    expect(toScriptImportPlainText(input)).toBe(
      ['将军：疯了。', '女主：你跟不跟我？', '将军：末将，愿为先锋。'].join('\n')
    );
  });

  it('replaces ResourceReference with fallbackLabel', () => {
    expect(
      toScriptImportPlainText(
        'See <ResourceReference kind="table-row" libraryId="11111111-1111-4111-8111-111111111111" assetId="22222222-2222-4222-8222-222222222222" displayFieldId="33333333-3333-4333-8333-333333333333" fallbackLabel="Ada" />.'
      )
    ).toBe('See Ada.');
  });
});
