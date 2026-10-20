import React from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { DirectMapPlanInspector } from '@/features/create-map/components/DirectMapPlanInspector';
import { DIRECT_MAP_PROFILE_VALUES } from '@/features/create-map/model/directMapSchema';
import { makeValidMapPlanV3 } from './fixtures';

jest.mock('@/features/create-map/CreateMapWorkbench.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

function findElement(node: React.ReactNode, predicate: (element: React.ReactElement<Record<string, unknown>>) => boolean): React.ReactElement<Record<string, unknown>> | null {
  if (!React.isValidElement(node)) return null;
  const element = node as React.ReactElement<Record<string, unknown>>;
  if (predicate(element)) return element;
  const children = (element.props as { children?: React.ReactNode }).children;
  for (const child of React.Children.toArray(children)) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

describe('DirectMapPlanInspector', () => {
  it('edits the exact final prompt without compiling it', () => {
    const onChange = jest.fn();
    const tree = DirectMapPlanInspector({ plan: makeValidMapPlanV3(), issues: [], onChange });
    const textarea = findElement(tree, (element) => element.props['aria-label'] === 'PixelLab description');

    expect(textarea).not.toBeNull();
    (textarea?.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: 'Exact replacement prompt' },
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ description: 'Exact replacement prompt' }));
  });

  it('offers only supported profiles and shows the exact character budget', () => {
    const markup = renderToStaticMarkup(React.createElement(DirectMapPlanInspector, {
      plan: makeValidMapPlanV3(), issues: [], onChange: jest.fn(), versionLabel: 'Version1',
    }));

    for (const profile of DIRECT_MAP_PROFILE_VALUES) {
      expect(markup).toContain(profile.replace('x', ' × '));
    }
    expect(markup.match(/<option/g)).toHaveLength(DIRECT_MAP_PROFILE_VALUES.length);
    expect(markup).toContain(`${makeValidMapPlanV3().description.length} / 2000`);
    expect(markup).toContain('Seed');
    expect(markup).not.toContain('Tile size');
    expect(markup).toContain('Version1');
  });

  it('uses the Map plan details typography and textarea dimensions', () => {
    const css = readFileSync(
      path.join(process.cwd(), 'src/features/create-map/CreateMapWorkbench.module.css'),
      'utf8',
    );

    expect(css).toMatch(/\.directPlanInspector \.fieldLabel\s*\{[^}]*color:\s*#0a0a0a[^}]*font-size:\s*14px[^}]*font-weight:\s*500[^}]*line-height:\s*20px/s);
    expect(css).toMatch(/\.planDetailsHeading\s*\{[^}]*border-bottom:\s*1px solid var\(--create-map-line\)/s);
    expect(css).toMatch(/\.directPlanInspector\s*\{[^}]*padding:\s*0 17\.5px 16px/s);
    expect(css).toMatch(/\.planDetailsHeading\s*\{[^}]*margin:\s*0 -17\.5px/s);
    expect(css).toMatch(/\.directPlanInspector \.textareaCompact\s*\{[^}]*min-height:\s*73px/s);
    expect(css).toMatch(/\.directPlanInspector \.directDescription\s*\{[^}]*height:\s*73px/s);
  });
});
