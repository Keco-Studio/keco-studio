import { collectGddDocumentAssetReferences } from './documentAssets';

const ARTIFACT = '11111111-1111-4111-8111-111111111111';
const ROW = '22222222-2222-4222-8222-222222222222';

describe('GDD document image inventory', () => {
  it('walks sanctioned MDX and deduplicates stable sources', () => {
    const markdown = [
      '# GDD',
      `<GddMapReference artifactId="${ARTIFACT}" display="full" fallbackTitle="Harbor" />`,
      `<GddMapReference artifactId="${ARTIFACT}" display="compact" fallbackTitle="Duplicate" />`,
      `<ResourceReference kind="table-row" libraryId="33333333-3333-4333-8333-333333333333" assetId="${ROW}" displayFieldId="44444444-4444-4444-8444-444444444444" fallbackLabel="Portrait" />`,
      '![Concept](https://example.test/a.png#fragment)',
      '![Same](https://example.test/a.png)',
    ].join('\n\n');
    expect(collectGddDocumentAssetReferences(markdown)).toEqual([
      { sourceType: 'gdd_map_artifact', sourceId: ARTIFACT, label: 'Harbor' },
      { sourceType: 'resource_reference', sourceId: ROW, label: 'Portrait' },
      { sourceType: 'markdown_image', sourceId: 'https://example.test/a.png', label: 'Concept' },
    ]);
  });
});
