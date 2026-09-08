import type { SupabaseClient } from '@supabase/supabase-js';
import { readDocumentState } from '@/lib/documents/documentStateGateway';
import { resolveGddMapDevelopmentRecords } from '@/lib/documents/gddMapArtifactService';
import { hashNormalizedMarkdown, sha256CanonicalJson } from '@/lib/gdd-generation/resourceEvolution';
import { gameArtStyleSnapshotSchema } from '@/lib/game-art-style/schema';
import {
  gddDevelopmentContextSchema,
  type DevelopmentContextWarning,
  type DevelopmentTargetProfile,
  type GddDevelopmentAsset,
  type GddDevelopmentContext,
} from './contracts';
import { collectGddDocumentAssetReferences } from './documentAssets';
import { evaluateRuntimeCompatibility } from './runtimeCompatibility';

export class GddDevelopmentContextNotFoundError extends Error {
  constructor() {
    super('GDD Document not found.');
    this.name = 'GddDevelopmentContextNotFoundError';
  }
}

export type ReadGddDevelopmentContextInput = {
  projectId: string;
  documentId: string;
  targetProfile?: DevelopmentTargetProfile;
};

type ContextServiceDependencies = {
  readState?: typeof readDocumentState;
  resolveMaps?: typeof resolveGddMapDevelopmentRecords;
  now?: () => number;
};

export async function readGddDevelopmentContext(
  serviceClient: SupabaseClient,
  input: ReadGddDevelopmentContextInput,
  dependencies: ContextServiceDependencies = {},
): Promise<GddDevelopmentContext> {
  const { data: document, error: documentError } = await serviceClient.from('documents')
    .select('id,project_id,gdd_generation_job_id')
    .eq('id', input.documentId).eq('project_id', input.projectId).maybeSingle();
  if (documentError) throw documentError;
  if (!document) throw new GddDevelopmentContextNotFoundError();
  const state = await (dependencies.readState ?? readDocumentState)(serviceClient, input.documentId);
  if (state.projectId !== input.projectId) throw new GddDevelopmentContextNotFoundError();

  const warnings: DevelopmentContextWarning[] = [];
  let origin: GddDevelopmentContext['origin'] = null;
  let artStyle: GddDevelopmentContext['artStyle'] = null;
  const generationJobId = typeof document.gdd_generation_job_id === 'string' ? document.gdd_generation_job_id : null;
  if (generationJobId) {
    const { data: job, error: jobError } = await serviceClient.from('gdd_generation_jobs')
      .select('id,project_id,design_system_id,version_id,output_document_id')
      .eq('id', generationJobId).eq('project_id', input.projectId)
      .eq('output_document_id', input.documentId).maybeSingle();
    if (jobError) throw jobError;
    if (job) {
      const { data: version, error: versionError } = await serviceClient.from('game_design_system_versions')
        .select('id,system_id,version_number,content_hash,art_style')
        .eq('id', job.version_id).eq('system_id', job.design_system_id).maybeSingle();
      if (versionError) throw versionError;
      if (version) {
        origin = {
          generationJobId,
          designSystemId: String(job.design_system_id),
          versionId: String(version.id),
          versionNumber: Number(version.version_number),
          versionContentHash: String(version.content_hash),
        };
        const parsedStyle = gameArtStyleSnapshotSchema.safeParse(version.art_style);
        if (parsedStyle.success) {
          const previewAssets = [parsedStyle.data.previewAssetSet.map, parsedStyle.data.previewAssetSet.character, ...parsedStyle.data.previewAssetSet.supporting];
          artStyle = {
            snapshot: parsedStyle.data,
            contentHash: sha256CanonicalJson(parsedStyle.data),
            previewReferences: previewAssets.slice(0, 10).map(({ publicPath, sha256, width, height }) => ({
              publicPath, sha256, width, height, intendedRole: 'concept_only' as const,
            })),
          };
        } else if (version.art_style != null) {
          warnings.push({ code: 'ART_STYLE_UNSUPPORTED', sourceId: String(version.id), message: 'The historical Game Art Style snapshot is unsupported.' });
        }
      }
    }
    if (!origin) warnings.push({ code: 'ORIGIN_UNAVAILABLE', sourceId: generationJobId, message: 'The historical GDD generation origin is unavailable.' });
  } else {
    warnings.push({ code: 'ORIGIN_UNAVAILABLE', sourceId: null, message: 'This Document has no generated GDD origin.' });
  }

  const references = collectGddDocumentAssetReferences(state.markdown);
  const mapReferenceIds = references.filter((reference) => reference.sourceType === 'gdd_map_artifact').map((reference) => reference.sourceId);
  const maps = await (dependencies.resolveMaps ?? resolveGddMapDevelopmentRecords)(serviceClient, input.projectId, input.documentId, mapReferenceIds);
  const assets: GddDevelopmentAsset[] = [];
  for (const reference of references) {
    if (reference.sourceType === 'gdd_map_artifact') {
      const record = maps.get(reference.sourceId);
      const expectedStoragePath = record?.mapProjectId && record.asset?.sha256
        ? `${input.projectId}/${record.mapProjectId}/${record.asset?.mapRevisionId}/map-image/${record.asset.sha256}.png`
        : null;
      const ready = Boolean(record?.asset?.status === 'ready'
        && record.asset.storagePath === expectedStoragePath
        && record.asset.sha256);
      let delivery: GddDevelopmentAsset['delivery'] = null;
      if (ready) {
        const signed = await serviceClient.storage.from('map-assets').createSignedUrl(record!.asset!.storagePath!, 300);
        if (!signed.error && signed.data?.signedUrl) {
          delivery = { imageUrl: signed.data.signedUrl, expiresAt: new Date((dependencies.now ?? Date.now)() + 300_000).toISOString(), ephemeral: true };
        }
      }
      const base = {
        kind: 'map_image' as const,
        width: ready ? record!.asset!.width : null,
        height: ready ? record!.asset!.height : null,
        hasTransparency: ready ? record!.asset!.hasTransparency : null,
      };
      assets.push({
        sourceType: reference.sourceType,
        sourceId: reference.sourceId,
        label: reference.label,
        assetId: ready ? record!.asset!.id : null,
        revisionId: ready ? record!.asset!.mapRevisionId : null,
        sha256: ready ? record!.asset!.sha256 : null,
        ...base,
        contentType: ready ? 'image/png' : null,
        intendedRole: 'runtime_candidate',
        runtimeCompatibility: evaluateRuntimeCompatibility(base, input.targetProfile),
        delivery,
      });
      if (!ready) warnings.push({ code: 'ASSET_UNAVAILABLE', sourceId: reference.sourceId, message: 'The referenced GDD map asset is not ready or no longer available.' });
      continue;
    }
    const base = { kind: 'unknown' as const, width: null, height: null, hasTransparency: null };
    assets.push({
      sourceType: reference.sourceType,
      sourceId: reference.sourceId,
      label: reference.label,
      assetId: null,
      revisionId: null,
      sha256: null,
      ...base,
      contentType: null,
      intendedRole: 'unclassified',
      runtimeCompatibility: evaluateRuntimeCompatibility(base, input.targetProfile),
      delivery: null,
    });
    warnings.push({ code: 'IMAGE_UNCLASSIFIED', sourceId: reference.sourceId, message: 'The referenced image has no authoritative runtime or style role.' });
  }

  return gddDevelopmentContextSchema.parse({
    document: {
      id: state.documentId,
      epoch: state.token.epoch,
      revision: state.token.revision,
      contentHash: hashNormalizedMarkdown(state.markdown),
      updatedAt: state.updatedAt,
    },
    origin,
    artStyle,
    assets,
    warnings,
  });
}
