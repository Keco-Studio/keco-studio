import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (file: string) =>
  readFileSync(path.join(process.cwd(), file), 'utf8');

describe('Studio ContextMenu Generate table', () => {
  it('Studio ContextMenu keeps Generate table and omits Generate conversation', () => {
    const source = read('src/components/layout/ContextMenu.tsx');
    expect(source).toContain('Generate table');
    expect(source).toContain('generate-table');
    expect(source).not.toContain('Generate conversation');
    expect(source).not.toContain('generate-conversation');
    expect(source).toContain('Move to...');
  });
});
