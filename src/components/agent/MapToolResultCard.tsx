'use client';

import { z } from 'zod';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MapPlanV3Schema } from '@/features/create-map/model/directMapSchema';
import { publishCreateMapAgentRefresh } from '@/lib/create-map/agentRefresh';
import { parseMapToolData, type ConfirmationView } from './types';
import styles from './ChatPanel.module.css';

function imageDownloadUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function MapToolResultCard({ data }: { data: unknown }) {
  const map = parseMapToolData(data);
  if (!map) return null;
  if (map.kind === 'list') return (
    <section className={styles.confirmCard} aria-label="Saved maps" data-testid="agent-map-result">
      <strong>Saved maps</strong>
      {map.maps.length === 0 ? <p>No saved maps in this project.</p> : map.maps.map((entry) => (
        <p key={entry.mapId}><a href={`/create-map?mapId=${encodeURIComponent(entry.mapId)}`}>{entry.title}</a></p>
      ))}
      {map.nextCursor ? <p>More maps are available.</p> : null}
    </section>
  );
  const downloadUrl = map.generation?.status === 'ready' ? imageDownloadUrl(map.generation.imageUrl) : null;
  return (
    <section className={styles.confirmCard} aria-label="Map result" data-testid="agent-map-result">
      <strong>{map.plan?.title ?? 'Map generation'}</strong>
      {map.revisionNumber !== undefined ? <p>Version {map.revisionNumber}</p> : null}
      {map.plan ? <p>{map.plan.summary} · {map.plan.width} × {map.plan.height}</p> : null}
      {map.generation ? (
        <>
          <p>Status: {map.generation.status}</p>
          <p aria-label="Generation history">Generation history: {map.generation.attemptCount} attempt(s)</p>
          {map.generation.lastErrorCode ? <p>{map.generation.lastErrorCode}</p> : null}
        </>
      ) : null}
      <a href={`/create-map?mapId=${encodeURIComponent(map.mapId)}`}>View map plan</a>
      {downloadUrl ? <p><a href={downloadUrl} download target="_blank" rel="noopener noreferrer">Download map</a></p> : null}
    </section>
  );
}

const confirmationSchema = z.object({
  type: z.literal('map_generation'),
  projectId: z.string().uuid(),
  mapId: z.string().uuid(),
  nextDraftRevisionId: z.string().uuid().nullable().optional(),
  plan: MapPlanV3Schema,
  saveVersion: z.number().int().nonnegative(),
  feeNotice: z.string().min(1).max(1000),
  confirmationPurpose: z.enum(['submit', 'retry', 'replace-unknown']),
  confirmationExpiresAt: z.string().max(64),
  duplicateBillingWarning: z.string().max(1000).optional(),
});

export function MapGenerationConfirmationCard({ confirmation, disabled, onDecision }: {
  confirmation: ConfirmationView; disabled: boolean;
  onDecision: (actionId: string, decision: 'approve' | 'reject') => void;
}) {
  const queryClient = useQueryClient();
  const parsed = confirmationSchema.safeParse(confirmation.preview);
  const { projectId, mapId, nextDraftRevisionId } = parsed.success ? parsed.data : {};
  useEffect(() => {
    // Preparing publishes a revision and forks the editable draft, even if approval is cancelled.
    if (projectId && mapId && nextDraftRevisionId) {
      publishCreateMapAgentRefresh(queryClient, { projectId, mapId });
    }
  }, [projectId, mapId, nextDraftRevisionId, queryClient]);
  if (!parsed.success) return <div role="alert">Map confirmation is invalid. Request a new preview.</div>;
  const preview = parsed.data;
  return (
    <section className={styles.confirmCard} data-testid="agent-confirmation" aria-label="Confirm paid map generation">
      <strong>{preview.confirmationPurpose === 'submit' ? 'Generate map image' : 'Retry map generation'}: {preview.plan.name}</strong>
      <p>Saved version {preview.saveVersion}</p>
      <p>{preview.feeNotice}</p>
      {preview.duplicateBillingWarning ? <p>{preview.duplicateBillingWarning}</p> : null}
      <details open><summary>Exact map plan</summary><pre className={styles.pre}>{JSON.stringify(preview.plan, null, 2)}</pre></details>
      <p>Confirmation expires: {preview.confirmationExpiresAt}</p>
      {confirmation.resolved ? <p>{confirmation.resolved === 'approved' ? 'Approved.' : 'Cancelled.'}</p> : (
        <div className={styles.confirmInlineActions}>
          <button className={`${styles.btn} ${styles.btnPillPrimary}`} disabled={disabled} data-testid="agent-confirm" onClick={() => onDecision(confirmation.actionId, 'approve')}>Confirm paid generation</button>
          <button className={`${styles.btn} ${styles.btnPillGhost}`} disabled={disabled} data-testid="agent-reject" onClick={() => onDecision(confirmation.actionId, 'reject')}>Cancel</button>
        </div>
      )}
    </section>
  );
}
