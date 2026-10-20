import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

const parseStyles = (filePath: string) =>
  postcss.parse(readFileSync(path.join(process.cwd(), filePath), 'utf8'));

const declarationsFor = (root: postcss.Root, selector: string) => {
  const declarations: Record<string, string> = {};
  root.walkRules(selector, (rule) => {
    rule.walkDecls((declaration) => {
      declarations[declaration.prop] = declaration.value;
    });
  });
  return declarations;
};

describe('table image thumbnail layout styles', () => {
  it('lets the table image preview consume the resized cell while preserving the whole image', () => {
    const tableStyles = parseStyles('src/components/libraries/LibraryAssetsTable.module.css');
    const uploadStyles = parseStyles('src/components/media/MediaFileUpload.module.css');

    expect(declarationsFor(tableStyles, '.mediaFileUploadContainer')).toMatchObject({
      width: '100%',
      height: 'calc(var(--row-height, 32px) - 4px)',
      'max-height': 'none',
      overflow: 'hidden',
    });
    expect(declarationsFor(uploadStyles, '.containerTableCell')).toMatchObject({
      width: '100%',
      height: '100%',
      'min-width': '0',
      'min-height': '0',
    });
    expect(declarationsFor(uploadStyles, '.uploadedFileContainer.uploadedFileContainerTableCell')).toMatchObject({
      width: '100%',
      height: '100%',
      'min-width': '0',
      'min-height': '0',
    });
    expect(declarationsFor(uploadStyles, '.fileInfoClickableTableCell')).toMatchObject({
      width: '100%',
      height: '100%',
      'min-width': '0',
      'min-height': '0',
    });
    expect(declarationsFor(uploadStyles, '.fileInfoClickableTableCell .imageThumbnail')).toMatchObject({
      width: '100%',
      height: '100%',
      'max-width': '100%',
      'max-height': '100%',
      overflow: 'hidden',
      background: 'transparent',
      'border-radius': '0',
    });
    expect(declarationsFor(uploadStyles, '.fileInfoClickableTableCell .thumbnailImage')).toMatchObject({
      width: '100%',
      height: '100%',
      'object-fit': 'contain',
    });
  });
});
