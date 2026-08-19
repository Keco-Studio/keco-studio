import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const generatorPath = join(root, 'src/lib/gdd-generation/v2/generator.ts');

describe('current GDD v2 generation scope', () => {
  it('keeps the v2 generator on the direct Markdown path only', () => {
    const source = readFileSync(generatorPath, 'utf8');

    expect(source).not.toMatch(/export function buildBlueprintMessages/);
    expect(source).not.toMatch(/export async function generateGddBlueprint/);
    expect(source).not.toMatch(/export async function generateSectionBatch/);
    expect(source).not.toMatch(/export async function generateGddV2/);
    expect(source).not.toMatch(/export async function reviewGddDocument/);
    expect(source).not.toMatch(/export async function repairGddSections/);
  });

  it('does not retain standalone staged quality or renderer modules', () => {
    expect(existsSync(join(root, 'src/lib/gdd-generation/v2/quality.ts'))).toBe(false);
    expect(existsSync(join(root, 'src/lib/gdd-generation/v2/renderer.ts'))).toBe(false);
  });
});
