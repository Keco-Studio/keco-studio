import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

jest.mock('next/image', () => {
  function MockNextImage({
    src,
    alt,
    ...props
  }: {
    src: string;
    alt: string;
    [key: string]: unknown;
  }) {
    return React.createElement('img', { ...props, src, alt });
  }
  return MockNextImage;
});

import { PanelHeader } from '@/components/shared/PanelHeader';

describe('PanelHeader', () => {
  it('renders title with shared add and close icons', () => {
    const html = renderToStaticMarkup(
      <PanelHeader
        title="Version History"
        onAdd={() => undefined}
        addLabel="Create new version"
        onClose={() => undefined}
        closeLabel="Close"
      />
    );

    expect(html).toContain('Version History');
    expect(html).toContain('aria-label="Create new version"');
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain('src="test-file-stub"');
  });

  it('can hide add and keep close only', () => {
    const html = renderToStaticMarkup(
      <PanelHeader title="Asset detail" onClose={() => undefined} />
    );

    expect(html).toContain('Asset detail');
    expect(html).toContain('aria-label="Close"');
    expect(html.match(/src="test-file-stub"/g)).toHaveLength(1);
  });
});
