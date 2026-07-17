'use client';

import { useCallback, useMemo } from 'react';
import {
  DeleteOutlined,
  FileTextOutlined,
  RetweetOutlined,
  TableOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { Button, Tooltip } from 'antd';
import {
  useLexicalNodeRemove,
  useMdastNodeUpdater,
  type JsxEditorProps,
} from '@mdxeditor/editor';
import {
  parseResourceReferenceAttributes,
  resourceReferenceAttributes,
  type ResourceReferenceTarget,
} from '@/lib/documents/resourceReferenceTypes';
import { useResourceReference } from './ResourceReferenceProvider';
import styles from './MdxDocumentEditor.module.css';

export type ResourceReferenceReplacementHandler = (
  target: ResourceReferenceTarget,
  replaceTarget: (nextTarget: ResourceReferenceTarget) => void
) => void;

export type ResourceReferenceEditorProps = JsxEditorProps & {
  readOnly: boolean;
  onReplace?: ResourceReferenceReplacementHandler;
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

function mdastAttributes(target: ResourceReferenceTarget) {
  return Object.entries(resourceReferenceAttributes(target)).map(([name, value]) => ({
    type: 'mdxJsxAttribute' as const,
    name,
    value,
  }));
}

export function ResourceReferenceEditor({
  mdastNode,
  readOnly,
  onReplace,
}: ResourceReferenceEditorProps) {
  const target = useMemo(
    () => parseResourceReferenceAttributes(fixedAttributes(mdastNode)),
    [mdastNode]
  );
  const { isLoading, resolved } = useResourceReference(target);
  const updateMdastNode = useMdastNodeUpdater();
  const removeMdastNode = useLexicalNodeRemove();
  const replaceTarget = useCallback(
    (nextTarget: ResourceReferenceTarget) => {
      updateMdastNode({ attributes: mdastAttributes(nextTarget) });
    },
    [updateMdastNode]
  );
  const requestReplacement = useCallback(() => {
    if (target && onReplace) onReplace(target, replaceTarget);
  }, [onReplace, replaceTarget, target]);

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
    const accessibleLabel = resolved.contextLabel
      ? `${resolved.contextLabel}: ${resolved.label}`
      : resolved.label;
    reference = (
      <Tooltip title={accessibleLabel}>
        <a
          className={styles.resourceReference}
          href={resolved.href}
          aria-label={accessibleLabel}
        >
          {target.kind === 'table-row' ? <TableOutlined /> : <FileTextOutlined />}
          <span>{resolved.label}</span>
        </a>
      </Tooltip>
    );
  } else if (!resolved && isLoading) {
    reference = (
      <span
        className={`${styles.resourceReference} ${styles.resourceReferenceLoading}`}
        data-reference-loading="true"
        aria-label={`Loading reference: ${target.fallbackLabel}`}
      >
        {target.kind === 'table-row' ? <TableOutlined /> : <FileTextOutlined />}
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

  return (
    <span className={styles.resourceReferenceContainer}>
      {reference}
      {!readOnly && (
        <span className={styles.resourceReferenceActions}>
          <Tooltip title="Replace reference">
            <Button
              type="text"
              size="small"
              className={styles.resourceReferenceAction}
              aria-label="Replace reference"
              disabled={!target || !onReplace}
              icon={<RetweetOutlined />}
              onClick={requestReplacement}
            />
          </Tooltip>
          <Tooltip title="Remove reference">
            <Button
              type="text"
              size="small"
              danger
              className={styles.resourceReferenceAction}
              aria-label="Remove reference"
              icon={<DeleteOutlined />}
              onClick={removeMdastNode}
            />
          </Tooltip>
        </span>
      )}
    </span>
  );
}
