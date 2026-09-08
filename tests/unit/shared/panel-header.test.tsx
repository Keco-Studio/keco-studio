import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { PanelHeader } from '@/components/shared/PanelHeader';

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
jest.mock('@/assets/images/add.svg', () => 'add.svg', { virtual: true });
jest.mock('@/assets/images/close.svg', () => 'close.svg', { virtual: true });
jest.mock('@/components/shared/PanelHeader.module.css', () => ({
  header: 'header',
  identity: 'identity',
  titleGroup: 'titleGroup',
  title: 'title',
  subtitle: 'subtitle',
  actions: 'actions',
  iconButton: 'iconButton',
  iconButtonActive: 'iconButtonActive',
}));

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
    expect(html).toContain('src="add.svg"');
    expect(html).toContain('src="close.svg"');
  });

  it('can hide add and keep close only', () => {
    const html = renderToStaticMarkup(
      <PanelHeader title="Asset detail" onClose={() => undefined} />
    );

    expect(html).toContain('Asset detail');
    expect(html).toContain('aria-label="Close"');
    expect(html).not.toContain('src="add.svg"');
    expect(html).toContain('src="close.svg"');
  });
});
