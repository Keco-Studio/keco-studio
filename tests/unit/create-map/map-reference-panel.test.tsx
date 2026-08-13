import React from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import { MapReferencePanel } from '@/features/create-map/components/MapReferencePanel';
import type { MapReferenceRecord } from '@/features/create-map/services/createMapService';

jest.mock('@/features/create-map/CreateMapWorkbench.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

function reference(index: number): MapReferenceRecord {
  return {
    id: `10000000-0000-4000-8000-00000000000${index}`,
    projectId: 'project-1', name: `Reference ${index}`,
    storagePath: `references/project-1/${index}/${String(index).repeat(64)}.png`,
    sha256: String(index).repeat(64), width: 128, height: 128,
    contentType: 'image/png', byteSize: 1024,
    previewUrl: `/reference-${index}.png`,
  };
}

function findInput(
  node: React.ReactNode,
  predicate: (props: Record<string, unknown>) => boolean,
): React.ReactElement<Record<string, unknown>> | null {
  if (!React.isValidElement(node)) return null;
  const element = node as React.ReactElement<Record<string, unknown>>;
  if (element.type === 'input' && predicate(element.props)) return element;
  const children = (element.props as { children?: React.ReactNode }).children;
  for (const child of React.Children.toArray(children)) {
    const found = findInput(child, predicate);
    if (found) return found;
  }
  return null;
}

describe('MapReferencePanel', () => {
  it('enforces four content/layout references and one style reference', () => {
    const records = [1, 2, 3, 4, 5].map(reference);
    const markup = renderToStaticMarkup(React.createElement(MapReferencePanel, {
      projectId: 'project-1', records,
      references: records.slice(0, 4).map((item) => ({
        assetId: item.id, sha256: item.sha256, role: 'content' as const, usage: item.name,
      })),
      styleReference: null, busy: false, error: null,
      onReferencesChange: jest.fn(), onStyleReferenceChange: jest.fn(), onUpload: jest.fn(),
    }));

    expect(markup).toContain('4 / 4');
    expect(markup).toContain('Content');
    expect(markup).toContain('Layout');
    expect(markup).toContain('Style');
    expect(markup).toContain('type="file"');
  });

  it('emits only durable IDs and hashes when selecting a reference', () => {
    const source = reference(1);
    const onReferencesChange = jest.fn();
    const tree = MapReferencePanel({
      projectId: 'project-1', records: [source], references: [], styleReference: null,
      busy: false, error: null, onReferencesChange, onStyleReferenceChange: jest.fn(), onUpload: jest.fn(),
    });
    const markup = renderToStaticMarkup(tree);
    const contentInput = findInput(tree, (props) => props.checked === false && props.type === 'checkbox');

    (contentInput?.props.onChange as (event: { target: { checked: boolean } }) => void)({
      target: { checked: true },
    });

    expect(markup).toContain(source.previewUrl);
    expect(onReferencesChange).toHaveBeenCalledWith([{
      assetId: source.id,
      sha256: source.sha256,
      role: 'content',
      usage: source.name,
    }]);
    expect(onReferencesChange.mock.calls[0]?.[0]?.[0]).not.toHaveProperty('previewUrl');
  });
});
