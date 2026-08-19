import { describe, expect, it } from '@jest/globals';
import { buildDocumentExportModel } from './documentExportService';
import {
  decorateGddWithMapReferences,
  type GddMapReferenceArtifact,
} from './gddMapMarkdown';
import {
  gddMapReferenceAttributes,
  parseGddMapReferenceAttributes,
} from './gddMapReferenceTypes';
import { toScriptImportPlainText } from './scriptImportPlainText';
import { validateSanctionedMdx } from './sanctionedMdx';

const ARTIFACT_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_ID = '22222222-2222-4222-8222-222222222222';
const artifacts: GddMapReferenceArtifact[] = [
  { artifactId: ARTIFACT_ID, sourceHeading: 'World Map', fallbackTitle: 'World Map Preview' },
  { artifactId: SECOND_ID, sourceHeading: 'World Map', fallbackTitle: 'World Map Detail' },
];

describe('GDD map reference Markdown', () => {
  it('keeps zero-map Markdown byte-for-byte unchanged', () => {
    const markdown = '# Title\n\nA paragraph with  two spaces.\n';
    expect(decorateGddWithMapReferences(markdown, [])).toBe(markdown);
  });

  it('inserts compact references after the first exact heading and full references at the end', () => {
    const markdown = '# Title\n\n## World Map\n\nMap content.\n\n## World Map\n\nSecond section.\n';
    const decorated = decorateGddWithMapReferences(markdown, artifacts);
    expect(decorated.match(/<GddMapReference/g)).toHaveLength(4);
    expect(decorated.indexOf('World Map\n\n<GddMapReference')).toBeGreaterThan(-1);
    expect(decorated).toContain('## Maps and Levels');
    expect(decorated.indexOf(`artifactId="${ARTIFACT_ID}" display="compact"`)).toBeLessThan(
      decorated.indexOf(`artifactId="${ARTIFACT_ID}" display="full"`),
    );
    expect(decorated).not.toMatch(/https?:\/\//i);
    expect(() => validateSanctionedMdx(decorated)).not.toThrow();
  });

  it('sanitizes fallback titles and enforces exact, flow-only attributes', () => {
    expect(parseGddMapReferenceAttributes({
      ...gddMapReferenceAttributes({ artifactId: ARTIFACT_ID, display: 'compact', fallbackTitle: 'A map' }),
      fallbackTitle: ' Unsafe " title ',
    })?.fallbackTitle).toBe('Unsafe title');
    expect(parseGddMapReferenceAttributes({ artifactId: ARTIFACT_ID, display: 'compact', fallbackTitle: 'Map', extra: 'x' })).toBeNull();
    expect(() => validateSanctionedMdx(`<GddMapReference artifactId="${ARTIFACT_ID}" display="compact" fallbackTitle="Map" onClick="run" />`)).toThrow();
    expect(() => validateSanctionedMdx(`<p>See <GddMapReference artifactId="${ARTIFACT_ID}" display="compact" fallbackTitle="Map" /></p>`)).toThrow();
    expect(() => validateSanctionedMdx(`<GddMapReference artifactId="${ARTIFACT_ID}" display="compact" fallbackTitle="Map"><b>unsafe</b></GddMapReference>`)).toThrow();
  });

  it('renders readable fallback text for export and script import', () => {
    const markdown = `<GddMapReference artifactId="${ARTIFACT_ID}" display="full" fallbackTitle="Harbor Map" />`;
    const model = buildDocumentExportModel(markdown);
    expect(model.blocks).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: 'Harbor Map' }] }]);
    expect(toScriptImportPlainText(`# Maps\n\n${markdown}`)).toContain('Harbor Map');
    expect(toScriptImportPlainText(markdown)).not.toContain(ARTIFACT_ID);
  });

});
