'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { JsxEditorProps } from '@mdxeditor/editor';
import {
  gddDialogueDocumentHref,
  gddScriptFlowChartHref,
  parseGddScriptBranchSnapshotAttributes,
  parseGddScriptBranchTree,
} from '@/lib/documents/gddScriptBranchSnapshot';
import styles from './GddScriptBranchSnapshotEditor.module.css';

function fixedAttributes(mdastNode: JsxEditorProps['mdastNode']): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const attribute of mdastNode.attributes) {
    if (
      attribute.type !== 'mdxJsxAttribute'
      || typeof attribute.name !== 'string'
      || typeof attribute.value !== 'string'
    ) {
      continue;
    }
    attributes[attribute.name] = attribute.value;
  }
  return attributes;
}

export type GddScriptBranchSnapshotEditorProps = JsxEditorProps;

export function GddScriptBranchSnapshotEditor({
  mdastNode,
}: GddScriptBranchSnapshotEditorProps) {
  const parsed = useMemo(() => {
    const attributes = fixedAttributes(mdastNode);
    const snapshot = parseGddScriptBranchSnapshotAttributes(attributes);
    if (!snapshot) return null;
    const tree = parseGddScriptBranchTree(snapshot.tree);
    if (!tree) return null;
    return { snapshot, tree };
  }, [mdastNode]);

  if (!parsed) {
    return (
      <div className={styles.unavailable} data-gdd-script-branch-snapshot="invalid">
        Script branch snapshot unavailable
      </div>
    );
  }

  const { snapshot, tree } = parsed;
  const href = gddScriptFlowChartHref(snapshot.projectId, snapshot.scriptLibraryId);
  const dialogueHref = gddDialogueDocumentHref(snapshot.projectId, snapshot.dialogueDocumentId);

  return (
    <div className={styles.card} data-gdd-script-branch-snapshot={snapshot.dialogueJobId}>
      <Link
        className={styles.hitArea}
        href={href}
        aria-label={`Open Script FlowChart for ${snapshot.title}`}
      >
        <div className={styles.header}>
          <span className={styles.eyebrow}>Script branch</span>
          <span className={styles.title}>{snapshot.title}</span>
        </div>
        <ol className={styles.tree} aria-label="Branch tree preview">
          {tree.map((node, index) => (
            <li
              key={`${node.depth}:${node.label}:${index}`}
              className={styles.node}
              style={{ ['--depth' as string]: String(node.depth) }}
            >
              <span className={styles.nodeDot} aria-hidden />
              <span className={styles.nodeLabel}>{node.label}</span>
            </li>
          ))}
        </ol>
        <span className={styles.cta}>Open Script FlowChart</span>
      </Link>
      <Link className={styles.secondaryLink} href={dialogueHref}>
        Open Dialogue Document
      </Link>
    </div>
  );
}
