import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const componentSource = fs.readFileSync(
  path.join(process.cwd(), 'src/components/libraries/ImportScriptModal.tsx'),
  'utf8'
);
const styleSource = fs.readFileSync(
  path.join(process.cwd(), 'src/components/libraries/ImportScriptModal.module.css'),
  'utf8'
);

describe('Import Script modal copy', () => {
  it('does not advertise a standard script format', () => {
    for (const forbidden of [
      'STANDARD_FORMAT_EXAMPLE',
      'FORMAT_GUIDE',
      'showFormatGuide',
    ]) {
      expect(componentSource).not.toContain(forbidden);
    }
    const normalizedSource = componentSource.toLowerCase();
    for (const forbidden of [
      'load standard example',
      'format guide',
      'standard format',
      'standard input format',
    ]) {
      expect(normalizedSource).not.toContain(forbidden);
    }
    expect(componentSource).toContain('placeholder="Enter story text..."');
  });

  it('does not retain styles for removed guidance controls', () => {
    for (const forbidden of [
      '.textActions',
      '.exampleButton',
      '.formatGuide',
      '.formatSection',
      '.formatTips',
    ]) {
      expect(styleSource).not.toContain(forbidden);
    }
  });
});
