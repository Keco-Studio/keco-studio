'use client';

import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import type { JsxEditorProps } from '@mdxeditor/editor';
import { WarningOutlined, LoadingOutlined, EnvironmentOutlined } from '@ant-design/icons';
import { parseGddMapReferenceAttributes } from '@/lib/documents/gddMapReferenceTypes';
import { useGddMapReference } from './GddMapReferenceProvider';
import styles from './MdxDocumentEditor.module.css';

function attributes(node: JsxEditorProps['mdastNode']): Record<string, string> {
  const result: Record<string, string> = {};
  for (const attribute of node.attributes) {
    if (attribute.type !== 'mdxJsxAttribute' || typeof attribute.name !== 'string' || typeof attribute.value !== 'string') continue;
    result[attribute.name] = attribute.value;
  }
  return result;
}

export function GddMapReferenceEditor({ mdastNode }: JsxEditorProps) {
  const target = useMemo(() => parseGddMapReferenceAttributes(attributes(mdastNode)), [mdastNode]);
  const { artifactId, display, fallbackTitle } = target ?? { artifactId: null, display: 'compact', fallbackTitle: 'Map unavailable' };
  const { artifact, isLoading, hasError, register } = useGddMapReference(artifactId);
  useEffect(() => artifactId ? register(artifactId) : undefined, [artifactId, register]);

  if (!target || (!artifact && (hasError || !isLoading))) {
    return <span className={`${styles.gddMapState} ${styles.resourceReferenceUnavailable}`} aria-label={`${fallbackTitle}: map unavailable`}><WarningOutlined /><span>{fallbackTitle}</span></span>;
  }
  if (!artifact || isLoading) {
    return <span className={`${styles.gddMapState} ${styles.resourceReferenceLoading}`} aria-label={`Loading map: ${fallbackTitle}`}><LoadingOutlined /><span>{fallbackTitle}</span></span>;
  }
  const href = artifact.mapProjectId ? `/create-map?mapId=${encodeURIComponent(artifact.mapProjectId)}&viewer=1` : null;
  if (!artifact.imageUrl) {
    return <span className={styles.gddMapState} aria-label={`${artifact.title}: ${artifact.status}`}><EnvironmentOutlined /><span>{artifact.title}</span></span>;
  }
  const image = <img className={styles.gddMapImage} src={artifact.imageUrl} alt={artifact.title} width={artifact.width ?? undefined} height={artifact.height ?? undefined} loading="lazy" />;
  if (display === 'compact') {
    return <figure className={styles.gddMapCompact}><figcaption><EnvironmentOutlined />{href ? <Link href={href}>{artifact.title}</Link> : <span>{artifact.title}</span>}</figcaption>{image}</figure>;
  }
  return <figure className={styles.gddMapFull}><figcaption>{href ? <Link href={href}>{artifact.title}</Link> : artifact.title}</figcaption>{image}</figure>;
}
