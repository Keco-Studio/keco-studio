import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ResolvedResourceReference } from '@/lib/documents/resourceReferenceService';
import {
  resourceReferenceKey,
  type ResourceReferenceTarget,
} from '@/lib/documents/resourceReferenceTypes';

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const TABLE_TARGET: ResourceReferenceTarget = {
  kind: 'table-row',
  libraryId: '11111111-1111-4111-8111-111111111111',
  assetId: '22222222-2222-4222-8222-222222222222',
  displayFieldId: '33333333-3333-4333-8333-333333333333',
  fallbackLabel: 'Ada Lovelace',
};

const SECOND_TABLE_TARGET: ResourceReferenceTarget = {
  ...TABLE_TARGET,
  assetId: '66666666-6666-4666-8666-666666666666',
  fallbackLabel: 'Grace Hopper',
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
  registrationRevision?: number;
  resolvedReferences?: ReadonlyMap<string, ResolvedResourceReference>;
};
let groupResult: {
  containerRef: () => void;
  group: { isPrimary: boolean; keys: string[] } | undefined;
};
const nextLink = jest.fn();

jest.mock('@/components/documents/MdxDocumentEditor.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

jest.mock('@/components/documents/ResourceReferenceProvider', () => ({
  useResourceReference: () => referenceResult,
}));

jest.mock('@/components/documents/useTableReferenceGroup', () => ({
  useTableReferenceGroup: () => groupResult,
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => {
    nextLink(href);
    return <a href={href} {...props}>{children}</a>;
  },
}));

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

function tableReference(
  target: Extract<ResourceReferenceTarget, { kind: 'table-row' }>,
  values: Record<string, unknown>,
  fields = [
    { id: 'name-field', label: 'Name' },
    { id: 'status-field', label: 'Status' },
    { id: 'details-field', label: 'Details' },
  ]
): ResolvedResourceReference {
  const key = resourceReferenceKey(target);
  return {
    key,
    status: 'available',
    label: target.fallbackLabel,
    contextLabel: `Characters / ${target.fallbackLabel}`,
    href: `/${PROJECT_ID}/${target.libraryId}?asset=${target.assetId}`,
    table: {
      libraryId: target.libraryId,
      name: 'Characters',
      href: `/${PROJECT_ID}/${target.libraryId}`,
      fields,
      row: {
        assetId: target.assetId,
        name: target.fallbackLabel,
        values,
      },
    },
  };
}

describe('ResourceReferenceEditor', () => {
  beforeEach(() => {
    referenceResult = { resolved: undefined, isLoading: true, hasError: false };
    groupResult = { containerRef: () => undefined, group: undefined };
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
  ])('keeps the existing chip for an available $kind result without table data', ({ target, icon, contextLabel }) => {
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

  it('renders one table-row reference as an accessible chip with an asset deeplink', () => {
    const resolved = tableReference(TABLE_TARGET, {
      'name-field': 'Ada Lovelace',
      'status-field': null,
      'details-field': { level: 2 },
    });
    const key = resourceReferenceKey(TABLE_TARGET);
    referenceResult = {
      resolved,
      resolvedReferences: new Map([[key, resolved]]),
      registrationRevision: 1,
      isLoading: false,
      hasError: false,
    };
    groupResult = {
      containerRef: () => undefined,
      group: { isPrimary: true, keys: [key] },
    };

    const markup = renderReference(TABLE_TARGET, { readOnly: true });

    expect(markup).not.toContain('role="table"');
    expect(markup).toContain('aria-label="Characters / Ada Lovelace: Ada Lovelace"');
    expect(markup).toContain('href="/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/11111111-1111-4111-8111-111111111111?asset=22222222-2222-4222-8222-222222222222"');
    expect(markup).toContain('>Ada Lovelace<');
    expect(nextLink).toHaveBeenCalledWith(resolved.href);
  });

  it('renders grouped occurrences as ordered rows and suppresses later projections', () => {
    const firstKey = resourceReferenceKey(TABLE_TARGET);
    const secondKey = resourceReferenceKey(SECOND_TABLE_TARGET);
    const first = tableReference(TABLE_TARGET, {
      'name-field': 'Ada',
      'status-field': 'Active',
      'details-field': '',
    });
    const second = tableReference(SECOND_TABLE_TARGET, {
      'name-field': 'Grace',
      'status-field': 'Admiral',
      'details-field': false,
    });
    const resolvedReferences = new Map([
      [firstKey, first],
      [secondKey, second],
    ]);
    referenceResult = {
      resolved: first,
      resolvedReferences,
      registrationRevision: 2,
      isLoading: false,
      hasError: false,
    };
    groupResult = {
      containerRef: () => undefined,
      group: { isPrimary: true, keys: [firstKey, secondKey] },
    };

    const primaryMarkup = renderReference(TABLE_TARGET);

    expect(primaryMarkup.match(/role="row"/g)).toHaveLength(3);
    expect(primaryMarkup.indexOf('>Ada<')).toBeLessThan(primaryMarkup.indexOf('>Grace<'));
    expect(primaryMarkup).toContain('>false<');

    referenceResult = { ...referenceResult, resolved: second };
    groupResult = {
      containerRef: () => undefined,
      group: { isPrimary: false, keys: [firstKey, secondKey] },
    };
    const secondaryMarkup = renderReference(SECOND_TABLE_TARGET);

    expect(secondaryMarkup).toContain('data-reference-projection-suppressed="true"');
    expect(secondaryMarkup).not.toContain('role="table"');
  });

  it('keeps a partially unavailable occurrence in its table row position', () => {
    const firstKey = resourceReferenceKey(TABLE_TARGET);
    const secondKey = resourceReferenceKey(SECOND_TABLE_TARGET);
    const first = tableReference(TABLE_TARGET, {
      'name-field': 'Ada',
      'status-field': 'Active',
    });
    const unavailable: ResolvedResourceReference = {
      key: secondKey,
      status: 'unavailable',
      label: 'Reference unavailable',
    };
    referenceResult = {
      resolved: first,
      resolvedReferences: new Map([
        [firstKey, first],
        [secondKey, unavailable],
      ]),
      registrationRevision: 2,
      isLoading: false,
      hasError: false,
    };
    groupResult = {
      containerRef: () => undefined,
      group: { isPrimary: true, keys: [firstKey, secondKey] },
    };

    const markup = renderReference(TABLE_TARGET);

    expect(markup).toContain('data-reference-row-unavailable="true"');
    expect(markup).toContain('>Reference unavailable<');
    expect(markup.match(/role="row"/g)).toHaveLength(3);
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
