import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ResolvedResourceReference } from '@/lib/documents/resourceReferenceService';
import type { ResourceReferenceTarget } from '@/lib/documents/resourceReferenceTypes';

const TABLE_TARGET: ResourceReferenceTarget = {
  kind: 'table-row',
  libraryId: '11111111-1111-4111-8111-111111111111',
  assetId: '22222222-2222-4222-8222-222222222222',
  displayFieldId: '33333333-3333-4333-8333-333333333333',
  fallbackLabel: 'Ada Lovelace',
};

const DOCUMENT_TARGET: ResourceReferenceTarget = {
  kind: 'document-block',
  documentId: '44444444-4444-4444-8444-444444444444',
  blockId: '55555555-5555-4555-8555-555555555555',
  blockType: 'paragraph',
  fallbackLabel: 'The city closes its gates',
};

let referenceResult: {
  resolved: ResolvedResourceReference | undefined;
  isLoading: boolean;
  hasError: boolean;
};
const nextLink = jest.fn();

jest.mock('@/components/documents/MdxDocumentEditor.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

jest.mock('@/components/documents/ResourceReferenceProvider', () => ({
  useResourceReference: () => referenceResult,
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => {
    nextLink(href);
    return <a href={href} {...props}>{children}</a>;
  },
}));

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, ...props }: { src: string; [key: string]: unknown }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} data-icon="reference" alt="" {...props} />
  ),
}));
jest.mock('@/assets/images/reference.svg', () => 'reference.svg', { virtual: true });

jest.mock('@ant-design/icons', () => ({
  TableOutlined: () => <svg data-icon="table" />,
  WarningOutlined: () => <svg data-icon="warning" />,
}));

jest.mock('antd', () => ({
  Tooltip: ({ children, title }: { children: ReactNode; title: ReactNode }) => (
    <span data-tooltip={String(title)}>{children}</span>
  ),
}));

import { ResourceReferenceEditor } from '@/components/documents/ResourceReferenceEditor';

function mdastNode(target: ResourceReferenceTarget) {
  return {
    type: 'mdxJsxTextElement',
    name: 'ResourceReference',
    attributes: Object.entries(target).map(([name, value]) => ({
      type: 'mdxJsxAttribute',
      name,
      value,
    })),
    children: [],
  };
}

function renderReference(
  target: ResourceReferenceTarget,
  options: {
    readOnly?: boolean;
  } = {}
) {
  return renderToStaticMarkup(
    <ResourceReferenceEditor
      mdastNode={mdastNode(target) as never}
      descriptor={{} as never}
      readOnly={options.readOnly ?? false}
    />
  );
}

describe('ResourceReferenceEditor', () => {
  beforeEach(() => {
    referenceResult = { resolved: undefined, isLoading: true, hasError: false };
    nextLink.mockReset();
  });

  it('keeps the fallback label in the fixed inline surface while loading', () => {
    const markup = renderReference(TABLE_TARGET, { readOnly: true });

    expect(markup).toContain('data-reference-loading="true"');
    expect(markup).toContain('Ada Lovelace');
    expect(markup).toContain('resourceReference');
    expect(markup).not.toContain('href=');
  });

  it.each([
    {
      kind: 'table-row' as const,
      target: TABLE_TARGET,
      icon: 'table',
      contextLabel: 'Characters / Ada / Status',
    },
    {
      kind: 'document-block' as const,
      target: DOCUMENT_TARGET,
      icon: 'reference',
      contextLabel: 'World bible / Opening',
    },
  ])('shows only the field value for an available $kind reference', ({ target, icon, contextLabel }) => {
    referenceResult = {
      isLoading: false,
      hasError: false,
      resolved: {
        key: 'resolved-key',
        status: 'available',
        label: target.fallbackLabel,
        contextLabel,
        href: `/project/lib/${target.kind === 'table-row' ? target.assetId : target.blockId}`,
      },
    };

    const markup = renderReference(target, { readOnly: true });
    const accessibleLabel = `${contextLabel}: ${target.fallbackLabel}`;

    expect(markup).toContain(`data-icon="${icon}"`);
    expect(markup).toContain('href="/project/');
    expect(markup).toContain(`>${target.fallbackLabel}<`);
    expect(markup).not.toContain(`>${accessibleLabel}<`);
    expect(markup).toContain(`aria-label="${accessibleLabel}"`);
    expect(markup).not.toContain('data-tooltip=');
    expect(nextLink).toHaveBeenCalledWith(referenceResult.resolved!.href);
  });

  it('renders the exact unavailable warning without a link', () => {
    referenceResult = {
      isLoading: false,
      hasError: false,
      resolved: {
        key: 'missing',
        status: 'unavailable',
        label: 'Reference unavailable',
      },
    };

    const markup = renderReference(TABLE_TARGET, { readOnly: true });

    expect(markup).toContain('data-icon="warning"');
    expect(markup).toContain('>Reference unavailable<');
    expect(markup).not.toContain('href=');
    expect(markup).not.toContain('data-tooltip=');
  });

  it('fails safely for invalid attributes', () => {
    const markup = renderToStaticMarkup(
      <ResourceReferenceEditor
        mdastNode={{ ...mdastNode(TABLE_TARGET), attributes: [] } as never}
        descriptor={{} as never}
        readOnly
      />
    );

    expect(markup).toContain('>Reference unavailable<');
    expect(markup).not.toContain('href=');
    expect(markup).not.toContain('data-tooltip=');
  });

  it('keeps the neutral fallback label on an initial resolver error', () => {
    referenceResult = {
      resolved: undefined,
      isLoading: false,
      hasError: true,
    };

    const markup = renderReference(TABLE_TARGET, { readOnly: true });

    expect(markup).toContain('Ada Lovelace');
    expect(markup).toContain('resourceReferenceLoading');
    expect(markup).not.toContain('Reference unavailable');
    expect(markup).not.toContain('href=');
    expect(markup).not.toContain('deleted or is no longer accessible');
  });

  it('omits replace and remove controls', () => {
    referenceResult = {
      isLoading: false,
      hasError: false,
      resolved: {
        key: 'resolved-key',
        status: 'available',
        label: TABLE_TARGET.fallbackLabel,
        contextLabel: 'Characters / Ada / Status',
        href: '/project/lib/asset',
      },
    };

    const markup = renderReference(TABLE_TARGET);

    expect(markup).not.toContain('aria-label="Replace reference"');
    expect(markup).not.toContain('aria-label="Remove reference"');
    expect(markup).not.toContain('resourceReferenceActions');
  });
});
