'use client';

import { Modal, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { MapPlanV3Schema, type MapPlanV3 } from '@/features/create-map/model/directMapSchema';
import { useSupabase } from '@/lib/SupabaseContext';
import styles from './MdxDocumentEditor.module.css';

export type MapPlanPreviewTarget = {
  title: string;
  mapProjectId: string | null;
  mapRevisionId: string | null;
  imageUrl: string | null;
  width: number | null;
  height: number | null;
};

type MapPlanPreview = {
  revisionNumber: number;
  plan: MapPlanV3;
};

async function loadArtifactPlan(
  supabase: ReturnType<typeof useSupabase>,
  projectId: string,
  artifact: MapPlanPreviewTarget,
): Promise<MapPlanPreview> {
  if (!artifact.mapProjectId || !artifact.mapRevisionId) {
    throw new Error('This map has no saved Plan yet.');
  }
  const { data: map, error: mapError } = await supabase
    .from('map_projects')
    .select('id')
    .eq('id', artifact.mapProjectId)
    .eq('project_id', projectId)
    .maybeSingle();
  if (mapError || !map) throw new Error(mapError?.message ?? 'This map is unavailable in the current project.');

  const { data: revision, error: revisionError } = await supabase
    .from('map_revisions')
    .select('revision_number,plan')
    .eq('id', artifact.mapRevisionId)
    .eq('map_project_id', artifact.mapProjectId)
    .eq('schema_version', 3)
    .maybeSingle();
  if (revisionError || !revision) throw new Error(revisionError?.message ?? 'The saved Plan version is unavailable.');
  const parsed = MapPlanV3Schema.safeParse(revision.plan);
  if (!parsed.success) throw new Error('The saved Plan version is invalid.');
  return { revisionNumber: Number(revision.revision_number), plan: parsed.data };
}

export function GddMapPlanPreviewModal({
  projectId,
  target,
  onClose,
}: {
  projectId: string;
  target: MapPlanPreviewTarget | null;
  onClose: () => void;
}) {
  const supabase = useSupabase();
  const planQuery = useQuery({
    queryKey: ['map-plan-preview', projectId, target?.mapProjectId, target?.mapRevisionId],
    queryFn: () => loadArtifactPlan(supabase, projectId, target!),
    enabled: Boolean(target?.mapProjectId && target?.mapRevisionId),
  });
  const preview = planQuery.data;

  return (
    <Modal
      open={Boolean(target)}
      title={target ? `Map Plan · ${target.title}` : 'Map Plan'}
      footer={null}
      width={860}
      destroyOnHidden
      onCancel={onClose}
    >
      {planQuery.isLoading ? <Spin aria-label="Loading map plan" /> : null}
      {planQuery.error ? <p role="alert">{planQuery.error instanceof Error ? planQuery.error.message : 'Could not load the saved Plan.'}</p> : null}
      {target?.imageUrl ? (
        <img
          className={styles.gddMapPlanPreviewImage}
          src={target.imageUrl}
          alt={target.title}
          width={target.width ?? undefined}
          height={target.height ?? undefined}
        />
      ) : null}
      {preview ? (
        <section className={styles.gddMapPlanPreview} aria-label="Saved map plan">
          <div><strong>{preview.plan.name}</strong><span>Plan V{preview.revisionNumber}</span></div>
          <p>{preview.plan.summary}</p>
          <dl>
            <div><dt>Output</dt><dd>{preview.plan.map.width} × {preview.plan.map.height}</dd></div>
            <div><dt>Provider</dt><dd>PixelLab</dd></div>
            <div><dt>References</dt><dd>{preview.plan.references.length}</dd></div>
          </dl>
          <h3>Generation description</h3>
          <p className={styles.gddMapPlanDescription}>{preview.plan.description}</p>
        </section>
      ) : null}
    </Modal>
  );
}
