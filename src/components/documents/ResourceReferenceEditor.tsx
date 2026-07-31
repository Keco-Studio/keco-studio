'use client';

import { useMemo } from 'react';
import Image from 'next/image';
import {
  TableOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { Tooltip } from 'antd';
import Link from 'next/link';
import type { JsxEditorProps } from '@mdxeditor/editor';
import referenceIcon from '@/assets/images/reference.svg';
import { parseResourceReferenceAttributes } from '@/lib/documents/resourceReferenceTypes';
import { useResourceReference } from './ResourceReferenceProvider';
import styles from './MdxDocumentEditor.module.css';

export type ResourceReferenceEditorProps = JsxEditorProps & {
  readOnly: boolean;
};

function DocumentReferenceIcon() {
  return (
    <Image
      src={referenceIcon}
      alt=""
      width={14}
      height={14}
      className={styles.resourceReferenceIcon}
      aria-hidden="true"
    />
  );
}

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
      <Tooltip title="The reference attributes are invalid or no longer supported">
        <span className={`${styles.resourceReference} ${styles.resourceReferenceUnavailable}`}>
          <WarningOutlined />
          <span>Reference unavailable</span>
        </span>
      </Tooltip>
    );
  } else if (resolved?.status === 'available' && resolved.href) {
    const accessibleLabel = accessibleReferenceLabel(resolved.label, resolved.contextLabel);
    reference = (
      <Tooltip title={accessibleLabel}>
        <Link
          className={styles.resourceReference}
          href={resolved.href}
          aria-label={accessibleLabel}
        >
          {target.kind === 'table-row' ? <TableOutlined /> : <DocumentReferenceIcon />}
          <span>{resolved.label}</span>
        </Link>
      </Tooltip>
    );
  } else if (!resolved && (isLoading || hasError)) {
    reference = (
      <span
        className={`${styles.resourceReference} ${styles.resourceReferenceLoading}`}
        data-reference-loading="true"
        aria-label={`Loading reference: ${target.fallbackLabel}`}
      >
        {target.kind === 'table-row' ? <TableOutlined /> : <DocumentReferenceIcon />}
        <span>{target.fallbackLabel}</span>
      </span>
    );
  } else {
    reference = (
      <Tooltip title="The source was deleted or is no longer accessible">
        <span className={`${styles.resourceReference} ${styles.resourceReferenceUnavailable}`}>
          <WarningOutlined />
          <span>Reference unavailable</span>
        </span>
      </Tooltip>
    );
  }

  return <span className={styles.resourceReferenceContainer}>{reference}</span>;
}
