import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.(?:ts|tsx|js|jsx)$/.test(entry.name) ? [file] : [];
  });
}

describe('Game Art Style runtime isolation', () => {
  it('keeps provider authoring code and endpoint references out of src', () => {
    const files = sourceFiles(join(process.cwd(), 'src'));
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/scripts\/game-art-style/);
      expect(source).not.toContain('image2.penguinsaichat.dpdns.org');
      expect(source).not.toContain('GAME_ART_STYLE_PROVIDER_API_KEY');
    }
  });
});
