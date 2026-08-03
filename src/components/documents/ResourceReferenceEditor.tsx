'use client';

import { useMemo } from 'react';
import {
  TableOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import Link from 'next/link';
import type { JsxEditorProps } from '@mdxeditor/editor';
import { parseResourceReferenceAttributes } from '@/lib/documents/resourceReferenceTypes';
import { DocumentReferenceIcon } from './DocumentReferenceIcon';
import { useResourceReference } from './ResourceReferenceProvider';
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

export function ResourceReferenceEditor({
  mdastNode,
  readOnly: _readOnly,
}: ResourceReferenceEditorProps) {
  const target = useMemo(
    () => parseResourceReferenceAttributes(fixedAttributes(mdastNode)),
    [mdastNode]
  );
  const { hasError, isLoading, resolved } = useResourceReference(target);

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

  return <span className={styles.resourceReferenceContainer}>{reference}</span>;
}
