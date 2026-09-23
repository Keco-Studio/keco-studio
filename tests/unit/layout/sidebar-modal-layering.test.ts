import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from '@jest/globals';

const sidebarStyles = readFileSync(
  join(process.cwd(), 'src/components/layout/Sidebar.module.css'),
  'utf8',
);

function sidebarRule(): string {
  const match = sidebarStyles.match(/\.sidebar\s*\{([\s\S]*?)\n\}/);
  if (!match) throw new Error('Sidebar CSS rule is missing');
  return match[1];
}

describe('Sidebar modal layering', () => {
  it('keeps the resource sidebar opaque when an image preview overlay is open', () => {
    const rule = sidebarRule();

    expect(rule).toMatch(/background-color:\s*#fff;/);
    expect(rule).not.toMatch(/backdrop-filter\s*:/);
  });
});
