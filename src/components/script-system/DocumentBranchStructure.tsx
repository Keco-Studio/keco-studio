'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { showErrorToast } from '@/lib/utils/toast';
import styles from './DocumentBranchStructure.module.css';

export type DocumentBranchDocument = { id: string; name: string };
export type DocumentBranchEdge = {
  id: string;
  parent_document_id: string;
  child_document_id: string;
  branch_name?: string | null;
};

export type DocumentBranchStructureProps = {
  projectId: string;
  folderId: string;
  folderName: string;
  documents: DocumentBranchDocument[];
  edges: DocumentBranchEdge[];
};

export function DocumentBranchStructure({
  projectId,
  folderId,
  folderName,
  documents,
  edges,
}: DocumentBranchStructureProps) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [parentDocumentId, setParentDocumentId] = useState(documents[0]?.id ?? '');
  const [childDocumentId, setChildDocumentId] = useState(documents[1]?.id ?? '');
  const [branchName, setBranchName] = useState('');
  const [saving, setSaving] = useState(false);
  const [localEdges, setLocalEdges] = useState(edges);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [connectionPoint, setConnectionPoint] = useState<{ x: number; y: number } | null>(null);
  const suppressNextNodeClick = useRef(false);

  useEffect(() => {
    setLocalEdges(edges);
  }, [edges]);
  const documentMap = new Map(documents.map((document) => [document.id, document]));
  const children = new Map<string, string[]>();
  for (const edge of localEdges) {
    const list = children.get(edge.parent_document_id) ?? [];
    list.push(edge.child_document_id);
    children.set(edge.parent_document_id, list);
  }
  const roots = documents.filter((document) => !localEdges.some((edge) => edge.child_document_id === document.id));
  const visible = roots.length > 0 ? roots : documents;
  const levels: string[][] = [];
  const visited = new Set<string>();
  let frontier = visible.map((document) => document.id);
  while (frontier.length > 0) {
    const current = frontier.filter((id) => !visited.has(id));
    if (current.length === 0) break;
    levels.push(current);
    current.forEach((id) => visited.add(id));
    frontier = current.flatMap((id) => children.get(id) ?? []);
  }
  const leftovers = documents.map((document) => document.id).filter((id) => !visited.has(id));
  if (leftovers.length > 0) levels.push(leftovers);
  const width = Math.max(640, Math.max(...levels.map((level) => level.length), 1) * 220 + 80);
  const layout = levels.flatMap((level, levelIndex) => level.flatMap((id, index) => {
    const document = documentMap.get(id);
    const levelOffset = (width - level.length * 220) / 2;
    return document ? [{ document, x: levelOffset + index * 220 + 20, y: 32 + levelIndex * 118 }] : [];
  }));
  const positions = new Map(layout.map((item) => [item.document.id, item]));
  const parentIds = new Set(localEdges.map((edge) => edge.child_document_id));
  const childIds = new Set(localEdges.map((edge) => edge.parent_document_id));
  const height = Math.max(260, 120 + Math.max(...levels.map((level) => level.length), 1) * 118);

  const beginConnection = (documentId: string, event: PointerEvent<SVGCircleElement>) => {
    event.stopPropagation();
    setConnectingFrom(documentId);
    suppressNextNodeClick.current = true;
  };

  const moveConnection = (event: PointerEvent<SVGSVGElement>) => {
    if (!connectingFrom) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setConnectionPoint({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  const finishConnection = (childDocumentId: string) => {
    if (!connectingFrom || connectingFrom === childDocumentId) return;
    setParentDocumentId(connectingFrom);
    setChildDocumentId(childDocumentId);
    setSubmitError(null);
    setDialogOpen(true);
    setConnectingFrom(null);
    setConnectionPoint(null);
  };

  const openDocument = (documentId: string) => {
    if (suppressNextNodeClick.current) {
      suppressNextNodeClick.current = false;
      return;
    }
    router.push(`/script-system/${projectId}/open/${documentId}`);
  };

  const deleteSelectedEdge = async () => {
    if (!selectedEdgeId) return;
    const response = await fetch(`/api/script-document-edges/${projectId}/${folderId}/${selectedEdgeId}`, { method: 'DELETE' });
    if (!response.ok) {
      showErrorToast('Failed to delete document relationship');
      return;
    }
    setLocalEdges((current) => current.filter((edge) => edge.id !== selectedEdgeId));
    setSelectedEdgeId(null);
  };

  return (
    <main className={styles.root}>
      <div className={styles.header}>
        <div><h1>Document Branch Structure</h1><p className={styles.subtitle}>{folderName}</p></div>
        <div className={styles.headerActions}>
          {selectedEdgeId ? <button type="button" className={styles.deleteButton} onClick={() => void deleteSelectedEdge()}>Delete relationship</button> : null}
          {documents.length > 1 ? <button type="button" className={styles.addButton} onClick={() => setDialogOpen(true)}>Add relationship</button> : null}
        </div>
      </div>
      {documents.length === 0 ? (
        <p className={styles.empty}>No Script documents in this folder.</p>
      ) : (
        <div className={styles.canvas}>
          <svg width={width} height={height} role="img" aria-label={`${folderName} document branch structure`} onPointerMove={moveConnection} onPointerUp={(event) => {
            if (event.target === event.currentTarget) suppressNextNodeClick.current = false;
            setConnectingFrom(null);
            setConnectionPoint(null);
          }}>
            <defs>
              <marker id="document-branch-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
              </marker>
            </defs>
            {localEdges.map((edge) => {
              const from = positions.get(edge.parent_document_id);
              const to = positions.get(edge.child_document_id);
              if (!from || !to) return null;
              return (
                <g key={edge.id}>
              <line x1={from.x + 90} y1={from.y + 48} x2={to.x + 90} y2={to.y} className={styles.edgeHitArea} onClick={(event) => { event.stopPropagation(); setSelectedEdgeId(edge.id); }} />
              <line x1={from.x + 90} y1={from.y + 48} x2={to.x + 90} y2={to.y} className={`${styles.edge} ${selectedEdgeId === edge.id ? styles.edgeSelected : ''}`} markerEnd="url(#document-branch-arrow)" pointerEvents="none" />
                  {edge.branch_name ? <text x={(from.x + to.x) / 2 + 90} y={(from.y + to.y) / 2} className={styles.edgeLabel}>{edge.branch_name}</text> : null}
                </g>
              );
            })}
            {layout.map(({ document, x, y }) => (
              <g
                key={document.id}
                className={styles.node}
                transform={`translate(${x}, ${y})`}
                role="button"
                tabIndex={0}
                onClick={() => openDocument(document.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') openDocument(document.id);
                }}
                data-document-node={document.id}
                onPointerUp={(event) => {
                  event.stopPropagation();
                  finishConnection(document.id);
                }}
              >
                <rect width="180" height="48" rx="8" />
                <text x="90" y="29" textAnchor="middle">{document.name}</text>
                {parentIds.has(document.id) || !childIds.has(document.id) ? <circle cx="90" cy="0" r="7" className={styles.connectionHandle} aria-label={`Connect to ${document.name}`} /> : null}
                {childIds.has(document.id) || !parentIds.has(document.id) ? <circle cx="90" cy="48" r="7" className={styles.connectionHandle} onPointerDown={(event) => beginConnection(document.id, event)} aria-label={`Connect from ${document.name}`} /> : null}
              </g>
            ))}
            {connectingFrom && connectionPoint ? <line x1={(positions.get(connectingFrom)?.x ?? 0) + 90} y1={(positions.get(connectingFrom)?.y ?? 0) + 48} x2={connectionPoint.x} y2={connectionPoint.y} className={styles.connectionPreview} /> : null}
          </svg>
        </div>
      )}
      {documents.length > 1 ? (
        <>
          {dialogOpen && typeof document !== 'undefined' ? createPortal(
            <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => {
              if (event.target === event.currentTarget) setDialogOpen(false);
            }}>
              <form className={styles.dialog} onSubmit={async (event) => {
                event.preventDefault();
                setSubmitError(null);
                if (!parentDocumentId || !childDocumentId || parentDocumentId === childDocumentId) return;
                setSaving(true);
                try {
                  const response = await fetch(`/api/script-document-edges/${projectId}/${folderId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ parentDocumentId, childDocumentId, branchName }),
                  });
                  const body = await response.json().catch(() => null) as { edge?: DocumentBranchEdge; error?: string; existing?: boolean } | null;
                  if (!response.ok || !body?.edge) throw new Error(body?.error || `Failed to create relationship (${response.status})`);
                  setLocalEdges((current) => current.some((edge) => edge.id === body.edge!.id) ? current : [...current, body.edge!]);
                  setBranchName('');
                  setDialogOpen(false);
                } catch (error) {
                  const message = error instanceof Error ? error.message : 'Failed to create relationship';
                  setSubmitError(message);
                  showErrorToast(message);
                } finally {
                  setSaving(false);
                }
              }}>
                <h2>Connect documents</h2>
                <label>From<select value={parentDocumentId} onChange={(event) => setParentDocumentId(event.target.value)}>{documents.map((document) => <option key={document.id} value={document.id}>{document.name}</option>)}</select></label>
                <label>To<select value={childDocumentId} onChange={(event) => setChildDocumentId(event.target.value)}>{documents.map((document) => <option key={document.id} value={document.id}>{document.name}</option>)}</select></label>
                <label>Branch name (optional)<input value={branchName} onChange={(event) => setBranchName(event.target.value)} /></label>
                {submitError ? <p className={styles.dialogError} role="alert">{submitError}</p> : null}
                <div className={styles.dialogActions}><button type="button" onClick={() => setDialogOpen(false)}>Cancel</button><button type="submit" disabled={saving || parentDocumentId === childDocumentId}>{saving ? 'Saving...' : 'Connect'}</button></div>
              </form>
            </div>,
            document.body,
          ) : null}
        </>
      ) : null}
    </main>
  );
}
