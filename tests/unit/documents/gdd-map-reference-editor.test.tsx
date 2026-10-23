/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { JsxEditorProps } from '@mdxeditor/editor';
import { GddMapReferenceEditor } from '@/components/documents/GddMapReferenceEditor';

const ARTIFACT_ID = '11111111-1111-4111-8111-111111111111';
const MAP_ID = '22222222-2222-4222-8222-222222222222';
const openMap = jest.fn();

jest.mock('@/components/documents/MdxDocumentEditor.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

jest.mock('@/components/documents/GddMapReferenceProvider', () => ({
  useGddMapReference: () => ({
    artifact: {
      artifactId: ARTIFACT_ID,
      title: 'Nan Yu delivery map',
      status: 'ready',
      phase: 'ready',
      mapProjectId: MAP_ID,
      mapRevisionId: '33333333-3333-4333-8333-333333333333',
      mapAssetId: '44444444-4444-4444-8444-444444444444',
      imageUrl: 'https://example.test/map.png',
      width: 512,
      height: 512,
      error: null,
    },
    isLoading: false,
    hasError: false,
    register: () => () => undefined,
  }),
}));

jest.mock('@ant-design/icons', () => ({
  WarningOutlined: () => null,
  LoadingOutlined: () => null,
  EnvironmentOutlined: () => null,
}));

function node(): JsxEditorProps['mdastNode'] {
  return {
    type: 'mdxJsxTextElement',
    name: 'GddMapReference',
    attributes: [
      { type: 'mdxJsxAttribute', name: 'artifactId', value: ARTIFACT_ID },
      { type: 'mdxJsxAttribute', name: 'display', value: 'compact' },
      { type: 'mdxJsxAttribute', name: 'fallbackTitle', value: 'Nan Yu delivery map' },
    ],
    children: [],
  } as JsxEditorProps['mdastNode'];
}

describe('GddMapReferenceEditor', () => {
  beforeEach(() => openMap.mockClear());

  it('opens its map plan in the current document instead of navigating to Create Map', () => {
    const Editor = GddMapReferenceEditor as unknown as (props: JsxEditorProps & {
      onOpenMap: (artifact: { mapProjectId: string; mapRevisionId: string | null }) => void;
    }) => React.ReactElement;
    render(<Editor mdastNode={node()} descriptor={{} as never} onOpenMap={openMap} />);

    expect(screen.queryByRole('link', { name: 'Nan Yu delivery map' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open map plan: Nan Yu delivery map' }));
    expect(openMap).toHaveBeenCalledWith(expect.objectContaining({
      mapProjectId: MAP_ID,
      mapRevisionId: '33333333-3333-4333-8333-333333333333',
    }));
  });
});
