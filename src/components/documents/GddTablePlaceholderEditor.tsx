'use client';

import { useMemo } from 'react';
import { TableOutlined } from '@ant-design/icons';
import type { JsxEditorProps } from '@mdxeditor/editor';
import styles from './MdxDocumentEditor.module.css';

function tableName(node: JsxEditorProps['mdastNode']): string {
  const attribute = node.attributes.find((candidate) => (
    candidate.type === 'mdxJsxAttribute'
    && candidate.name === 'tableName'
    && typeof candidate.value === 'string'
  ));
  return typeof attribute?.value === 'string' ? attribute.value : 'Table';
}

export function GddTablePlaceholderEditor({
  mdastNode,
}: Pick<JsxEditorProps, 'mdastNode'>) {
  const name = useMemo(() => tableName(mdastNode), [mdastNode]);
  return (
    <div className={styles.gddTablePlaceholder} aria-label={`Table pending: ${name}`}>
      <TableOutlined />
      <span>{name}</span>
    </div>
  );
}
