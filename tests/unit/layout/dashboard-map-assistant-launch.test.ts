import { readFileSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';

describe('Map navigation wiring', () => {
  it('does not install a Map-to-Agent redirect in the dashboard shell', () => {
    const source = readFileSync('src/components/layout/DashboardLayout.tsx', 'utf8');

    expect(source).not.toContain('isMapAssistantLaunchRequest');
    expect(source).not.toContain("router.replace('/game-design-systems')");
  });
});
