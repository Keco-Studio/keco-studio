'use client';

import { useMemo } from 'react';
import {
  TableOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import Link from 'next/link';
import type { JsxEditorProps } from '@mdxeditor/editor';
import type { ResolvedResourceReference } from '@/lib/documents/resourceReferenceService';
import {
  parseResourceReferenceAttributes,
  resourceReferenceKey,
} from '@/lib/documents/resourceReferenceTypes';
import { cellDisplayString } from '@/lib/utils/assetEmptiness';
import { DocumentReferenceIcon } from './DocumentReferenceIcon';
import { useResourceReference } from './ResourceReferenceProvider';
import { useTableReferenceGroup } from './useTableReferenceGroup';
import styles from './MdxDocumentEditor.module.css';

export type ResourceReferenceEditorProps = JsxEditorProps & {
  readOnly: boolean;
};

function fixedAttributes(mdastNode: JsxEditorProps['mdastNode']): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const attribute of mdastNode.attributes) {
    if (
      attribute.type !== 'mdxJsxAttribute' ||
      typeof attribute.name !== 'string' ||
      typeof attribute.value !== 'string'
    ) {
      continue;
    }
    attributes[attribute.name] = attribute.value;
  }
  return attributes;
}

function accessibleReferenceLabel(
  label: string,
  contextLabel: string | undefined
): string {
  return contextLabel ? `${contextLabel}: ${label}` : label;
}

function ReferenceKindIcon({ kind }: { kind: string }) {
  if (kind === 'table-row') return <TableOutlined />;
  return (
    <DocumentReferenceIcon
      size={14}
      className={styles.resourceReferenceIcon}
    />
  );
}

function TableReferenceProjection({
  references,
  schema,
}: {
  references: Array<ResolvedResourceReference | undefined>;
  schema: NonNullable<ResolvedResourceReference['table']>;
}) {
  const columnCount = Math.max(schema.fields.length, 1);
  return (
    <span className={styles.resourceReferenceTableProjection}>
      <Link
        className={styles.resourceReferenceTableName}
        href={schema.href}
      >
        {schema.name}
      </Link>
      <span className={styles.resourceReferenceTableViewport}>
        <span
          className={styles.resourceReferenceTable}
          role="table"
          aria-label={schema.name}
          style={{
            gridTemplateColumns: `repeat(${columnCount}, minmax(140px, 1fr))`,
          }}
        >
          <span className={styles.resourceReferenceTableRow} role="row">
            {schema.fields.map((field) => (
              <span
                className={styles.resourceReferenceTableHeader}
                role="columnheader"
                key={field.id}
              >
                {field.label}
              </span>
            ))}
          </span>
          {references.map((reference, occurrenceIndex) => {
            const row = reference?.status === 'available'
              ? reference.table?.row
              : undefined;
            if (!row) {
              return (
                <span
                  className={styles.resourceReferenceTableRow}
                  role="row"
                  key={`${reference?.key ?? 'unresolved'}:${occurrenceIndex}`}
                >
                  <span
                    className={styles.resourceReferenceTableUnavailableCell}
                    data-reference-row-unavailable="true"
                    role="cell"
                    style={{ gridColumn: `span ${columnCount}` }}
                  >
                    Reference unavailable
                  </span>
                </span>
              );
            }
            return (
              <span
                className={styles.resourceReferenceTableRow}
                role="row"
                key={`${reference.key}:${occurrenceIndex}`}
              >
                {schema.fields.map((field) => (
                  <span
                    className={styles.resourceReferenceTableCell}
                    role="cell"
                    key={field.id}
                  >
                    {cellDisplayString(row.values[field.id])}
                  </span>
                ))}
              </span>
            );
          })}
        </span>
      </span>
    </span>
  );
}

export function ResourceReferenceEditor({
  mdastNode,
  readOnly: _readOnly,
}: ResourceReferenceEditorProps) {
  const target = useMemo(
    () => parseResourceReferenceAttributes(fixedAttributes(mdastNode)),
    [mdastNode]
  );
  const {
    hasError,
    isLoading,
    registrationRevision = 0,
    resolved,
    resolvedReferences,
  } = useResourceReference(target);
  const { containerRef, group } = useTableReferenceGroup(
    registrationRevision,
    resolvedReferences
  );
  const key = target ? resourceReferenceKey(target) : '';
  const groupKeys = group?.keys ?? (key ? [key] : []);
  const groupReferences = groupKeys.map((groupKey) =>
    groupKey === key
      ? resolvedReferences?.get(groupKey) ?? resolved
      : resolvedReferences?.get(groupKey)
  );
  const tableSchema = target?.kind === 'table-row'
    ? groupReferences.find((reference) => reference?.table)?.table
    : undefined;
  const suppressTableProjection = Boolean(tableSchema && group && !group.isPrimary);
  // Keep single-row chips (accessible name + asset deeplink) for insert/smoke UX.
  // Multi-row adjacent groups still collapse into one projected table.
  const projectAsTable = Boolean(tableSchema && groupKeys.length > 1);

  let reference: React.ReactNode;
  if (!target) {
    reference = (
      <span
        className={`${styles.resourceReference} ${styles.resourceReferenceUnavailable}`}
        aria-label="The reference attributes are invalid or no longer supported"
      >
        <WarningOutlined />
        <span>Reference unavailable</span>
      </span>
    );
  } else if (projectAsTable) {
    reference = suppressTableProjection
      ? null
      : (
          <TableReferenceProjection
            references={groupReferences}
            schema={tableSchema!}
          />
        );
  } else if (resolved?.status === 'available' && resolved.href) {
    const accessibleLabel = accessibleReferenceLabel(resolved.label, resolved.contextLabel);
    reference = (
      <Link
        className={styles.resourceReference}
        href={resolved.href}
        aria-label={accessibleLabel}
      >
        <ReferenceKindIcon kind={target.kind} />
        <span>{resolved.label}</span>
      </Link>
    );
  } else if (!resolved && (isLoading || hasError)) {
    reference = (
      <span
        className={`${styles.resourceReference} ${styles.resourceReferenceLoading}`}
        data-reference-loading="true"
        aria-label={`Loading reference: ${target.fallbackLabel}`}
      >
        <ReferenceKindIcon kind={target.kind} />
        <span>{target.fallbackLabel}</span>
      </span>
    );
  } else {
    reference = (
      <span
        className={`${styles.resourceReference} ${styles.resourceReferenceUnavailable}`}
        aria-label="The source was deleted or is no longer accessible"
      >
        <WarningOutlined />
        <span>Reference unavailable</span>
      </span>
    );
  }

  return (
    <span
      ref={containerRef}
      className={`${styles.resourceReferenceContainer} ${
        projectAsTable ? styles.resourceReferenceTableContainer : ''
      } ${suppressTableProjection ? styles.resourceReferenceProjectionSuppressed : ''}`}
      data-resource-reference-kind={target?.kind}
      data-resource-reference-key={key || undefined}
      data-resource-reference-library-id={
        target?.kind === 'table-row'
          ? (resolved?.table?.libraryId ?? target.libraryId)
          : undefined
      }
      data-reference-projection-suppressed={
        suppressTableProjection ? 'true' : undefined
      }
    >
      {reference}
    </span>
  );
}
