import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(
  path.join(process.cwd(), 'src/components/media/MediaFileUpload.tsx'),
  'utf8'
);

describe('MediaFileUpload validation feedback', () => {
  it('renders the persisted validation error as an accessible alert', () => {
    expect(source).toContain('className={styles.errorMessage} role="alert"');
    expect(source).toMatch(/role="alert"[\s\S]*\{error\}/);
  });
});
