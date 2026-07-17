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
let buttonToInvoke: string | null = null;
const nextLink = jest.fn();
const updateMdastNode = jest.fn();
const removeMdastNode = jest.fn();

jest.mock('@/components/documents/MdxDocumentEditor.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

jest.mock('@/components/documents/ResourceReferenceProvider', () => ({
  useResourceReference: () => referenceResult,
}));

jest.mock('@mdxeditor/editor', () => ({
  useMdastNodeUpdater: () => updateMdastNode,
  useLexicalNodeRemove: () => removeMdastNode,
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => {
    nextLink(href);
    return <a href={href} {...props}>{children}</a>;
  },
}));

jest.mock('@ant-design/icons', () => ({
  DeleteOutlined: () => <svg data-icon="delete" />,
  FileTextOutlined: () => <svg data-icon="file-text" />,
  RetweetOutlined: () => <svg data-icon="retweet" />,
  TableOutlined: () => <svg data-icon="table" />,
  WarningOutlined: () => <svg data-icon="warning" />,
}));

jest.mock('antd', () => ({
  Button: ({
    children,
    icon,
    onClick,
    danger: _danger,
    size: _size,
    type: _type,
    ...props
  }: {
    children: ReactNode;
    icon?: ReactNode;
    onClick?: () => void;
    danger?: boolean;
    size?: string;
    type?: string;
    'aria-label'?: string;
  }) => {
    if (props['aria-label'] === buttonToInvoke) onClick?.();
    return <button {...props}>{icon}{children}</button>;
  },
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
    onReplace?: Parameters<typeof ResourceReferenceEditor>[0]['onReplace'];
  } = {}
) {
  return renderToStaticMarkup(
    <ResourceReferenceEditor
      mdastNode={mdastNode(target) as never}
      descriptor={{} as never}
      readOnly={options.readOnly ?? false}
      onReplace={options.onReplace}
    />
  );
}

describe('ResourceReferenceEditor', () => {
  beforeEach(() => {
    referenceResult = { resolved: undefined, isLoading: true, hasError: false };
    buttonToInvoke = null;
    nextLink.mockReset();
    updateMdastNode.mockReset();
    removeMdastNode.mockReset();
  });

  it('keeps the fallback label in the fixed inline surface while loading', () => {
    const markup = renderReference(TABLE_TARGET, { readOnly: true });

    expect(markup).toContain('data-reference-loading="true"');
    expect(markup).toContain('Ada Lovelace');
    expect(markup).toContain('resourceReference');
    expect(markup).not.toContain('href=');
  });

  it.each([
    [TABLE_TARGET, 'table'],
    [DOCUMENT_TARGET, 'file-text'],
  ] as const)('renders an available internal reference with context and icon', (target, icon) => {
    referenceResult = {
      isLoading: false,
      hasError: false,
      resolved: {
        key: 'resolved-key',
        status: 'available',
        label: target.fallbackLabel,
        contextLabel: target.kind === 'table-row' ? 'Characters / Status' : 'World outline / Conflict',
        href: target.kind === 'table-row' ? '/project/lib/library/asset/asset' : '/project/doc/document#block-id',
      },
    };

    const markup = renderReference(target, { readOnly: true });

    expect(markup).toContain(`data-icon="${icon}"`);
    expect(markup).toContain('href="/project/');
    expect(markup).toContain(`aria-label="${referenceResult.resolved!.contextLabel}: ${target.fallbackLabel}"`);
    expect(markup).toContain(`data-tooltip="${referenceResult.resolved!.contextLabel}: ${target.fallbackLabel}"`);
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

  it('omits replacement and removal controls for viewers', () => {
    const markup = renderReference(TABLE_TARGET, { readOnly: true });

    expect(markup).not.toContain('aria-label="Replace reference"');
    expect(markup).not.toContain('aria-label="Remove reference"');
  });

  it('renders named icon-only controls and removes the MDAST node', () => {
    buttonToInvoke = 'Remove reference';

    const markup = renderReference(TABLE_TARGET);

    expect(markup).toContain('aria-label="Replace reference"');
    expect(markup).toContain('data-tooltip="Replace reference"');
    expect(markup).toContain('aria-label="Remove reference"');
    expect(markup).toContain('data-tooltip="Remove reference"');
    expect(removeMdastNode).toHaveBeenCalledTimes(1);
  });

  it('exposes a narrow replacement trigger that updates fixed attributes', () => {
    buttonToInvoke = 'Replace reference';
    const onReplace = jest.fn((_target, replaceTarget) => {
      replaceTarget(DOCUMENT_TARGET);
    });

    renderReference(TABLE_TARGET, { onReplace });

    expect(onReplace).toHaveBeenCalledWith(TABLE_TARGET, expect.any(Function));
    expect(updateMdastNode).toHaveBeenCalledWith({
      attributes: Object.entries(DOCUMENT_TARGET).map(([name, value]) => ({
        type: 'mdxJsxAttribute',
        name,
        value,
      })),
    });
  });
});
