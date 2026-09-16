import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { documentContentCodec } from '@/lib/documents/documentContentCodec';
import { coerceGeneratedSanctionedMdx, validateSanctionedMdx } from '@/lib/documents/sanctionedMdx';
import { decorateGddWithMapReferences } from '@/lib/documents/gddMapMarkdown';
import { compileGddMapBriefs } from '../maps/compiler';
import {
  claimGddResourceJob,
  finishGddResourceJob,
  materializeGddMapArtifacts,
  materializeGddResourcePayload,
  readGddResourceDocument,
  retryGddResourceJob,
  type GddResourceJob,
} from '@/lib/services/gddGenerationService';
import { hashGddGenerationInput } from '@/lib/gddGeneration';
import { gameArtStyleSnapshotSchema, type GameArtStyleSnapshot } from '@/lib/game-art-style/schema';
import { randomUUID } from 'node:crypto';
import { reviewGddMarkdownV2 } from '../v2/generator';
import type { GddGenerationRequestV2 } from '../v2/contracts';
import { loadSeriesTableLibraryIds } from '../seriesTableIds';
import { applyInlineTableResourceReferences, materializeTableResources, sanitizeTableResourcesForPersistence } from '../tableResources';
import { applyDialogueResourceReferences, materializeDialogueResources, normalizeDialoguePlans } from '../dialogueResources';

function resolveArtStyle(value: unknown): GameArtStyleSnapshot | null {
  if (value == null) return null;
  const parsed = gameArtStyleSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

type Dependencies = {
  claim: typeof claimGddResourceJob;
  finish: typeof finishGddResourceJob;
  retry: typeof retryGddResourceJob;
  compile: typeof compileGddMapBriefs;
  materialize: typeof materializeGddResourcePayload;
  materializeMaps?: typeof materializeGddMapArtifacts;
  readDocument?: typeof readGddResourceDocument;
  review: typeof reviewGddMarkdownV2;
};

const defaults: Dependencies = {
  claim: claimGddResourceJob,
  finish: finishGddResourceJob,
  retry: retryGddResourceJob,
  compile: compileGddMapBriefs,
  materialize: materializeGddResourcePayload,
  materializeMaps: materializeGddMapArtifacts,
  readDocument: readGddResourceDocument,
  review: reviewGddMarkdownV2,
};

function message(error: unknown): string {
  if (error && typeof error === 'object') {
    const value = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const parts = [value.message, value.details, value.hint]
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim());
    if (parts.length > 0) {
      const code = typeof value.code === 'string' && value.code.trim() ? ` [${value.code.trim()}]` : '';
      return `${parts.join(': ')}${code}`.slice(0, 1_000);
    }
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized.slice(0, 1_000);
    } catch {
      // Fall through to the stable resource error below.
    }
  }
  if (typeof error === 'string' && error.trim()) return error.trim().slice(0, 1_000);
  return 'GDD resource generation failed.';
}

export async function processClaimedGddResourceJob(
  input: { serviceClient: SupabaseClient; workerId: string; job: GddResourceJob },
  dependencies: Dependencies = defaults,
): Promise<'completed' | 'queued' | 'failed'> {
  const { serviceClient, workerId, job } = input;
  const readDocument = dependencies.readDocument ?? defaults.readDocument!;
  const materializeMaps = dependencies.materializeMaps ?? defaults.materializeMaps!;
  try {
    if (job.kind === 'maps') {
      const payload = job.payload as { markdown?: unknown; artStyle?: unknown };
      if (typeof payload.markdown !== 'string') throw new Error('Map resource payload is missing Markdown.');
      const briefs = await dependencies.compile({
        markdown: payload.markdown,
        artStyle: resolveArtStyle(payload.artStyle),
      });
      const artifacts = briefs.map((brief) => ({
        id: randomUUID(),
        mapBriefId: brief.id,
        title: brief.title,
        mapBrief: brief,
        styleContract: brief.styleContract,
        inputHash: hashGddGenerationInput({ brief, styleContract: brief.styleContract }),
      }));
      if (artifacts.length > 0) {
        const document = await readDocument(serviceClient, job.document_id);
        const markdown = coerceGeneratedSanctionedMdx(decorateGddWithMapReferences(
          document.markdown,
          briefs.map((brief, index) => ({
            artifactId: artifacts[index]!.id,
            sourceHeading: brief.sourceHeading,
            fallbackTitle: brief.title,
          })),
        ));
        validateSanctionedMdx(markdown);
        const yjsState = await documentContentCodec.markdownToYjsState(markdown);
        await materializeMaps(serviceClient, {
          jobId: job.gdd_generation_job_id,
          documentId: job.document_id,
          expectedMarkdown: document.markdown,
          markdown,
          yjsState,
          mapArtifacts: artifacts,
        });
      }
    } else if (job.kind === 'tables') {
      const payload = job.payload as { markdown?: unknown; input?: unknown; resources?: unknown };
      if (typeof payload.markdown !== 'string' || !payload.input || typeof payload.input !== 'object') {
        throw new Error('Resource payload is missing its GDD context.');
      }
      const gddInput = payload.input as GddGenerationRequestV2;
      let tableResources;
      if (Array.isArray(payload.resources) && payload.resources.length > 0) {
        tableResources = sanitizeTableResourcesForPersistence(payload.resources);
      } else {
        const reviewed = await dependencies.review(
          { ...gddInput, resourceMode: 'inline' },
          payload.markdown,
          {},
          { recoverDialogue: false },
        );
        const expectedTables = gddInput.rules.tableGuidance.map((guidance) => guidance.table.toLocaleLowerCase());
        const generatedTables = new Set(reviewed.tablePlans.map((plan) => plan.table.toLocaleLowerCase()));
        const missing = expectedTables.filter((table) => !generatedTables.has(table));
        if (missing.length > 0) throw new Error(`Async table generation is still missing: ${missing.join(', ')}.`);
        const existingIds = await loadSeriesTableLibraryIds(serviceClient, job.project_id, gddInput.designSystemId);
        tableResources = sanitizeTableResourcesForPersistence(
          materializeTableResources(`${job.project_id}:${gddInput.designSystemId}`, reviewed.tablePlans, existingIds),
        );
      }
      const document = await readDocument(serviceClient, job.document_id);
      const markdown = coerceGeneratedSanctionedMdx(
        applyInlineTableResourceReferences(document.markdown, tableResources),
      );
      validateSanctionedMdx(markdown);
      const yjsState = await documentContentCodec.markdownToYjsState(markdown);
      await dependencies.materialize(serviceClient, {
        jobId: job.gdd_generation_job_id,
        documentId: job.document_id,
        workerId,
        expectedMarkdown: document.markdown,
        metadata: { source: 'gdd_async_resource_worker', resourceJobId: job.id },
        tableResources,
        dialogueResources: [],
        markdown,
        yjsState,
      });
    } else if (job.kind === 'dialogue') {
      const payload = job.payload as { dialoguePlans?: unknown };
      const dialoguePlans = normalizeDialoguePlans(payload.dialoguePlans);
      if (dialoguePlans.length === 0) throw new Error('Dialogue resource payload has no story plans.');
      const dialogueResources = materializeDialogueResources(job.gdd_generation_job_id, dialoguePlans);
      const document = await readDocument(serviceClient, job.document_id);
      const markdown = coerceGeneratedSanctionedMdx(
        applyDialogueResourceReferences(document.markdown, job.project_id, dialogueResources),
      );
      validateSanctionedMdx(markdown);
      const yjsState = await documentContentCodec.markdownToYjsState(markdown);
      await dependencies.materialize(serviceClient, {
        jobId: job.gdd_generation_job_id,
        documentId: job.document_id,
        workerId,
        expectedMarkdown: document.markdown,
        metadata: { source: 'gdd_async_resource_worker', resourceJobId: job.id },
        tableResources: [],
        dialogueResources,
        markdown,
        yjsState,
      });
    }
    const result = await dependencies.finish(serviceClient, { jobId: job.id, workerId, status: 'completed' });
    return result === 'completed' ? 'completed' : 'failed';
  } catch (error) {
    const result = await dependencies.retry(serviceClient, { jobId: job.id, workerId, error: message(error), delaySeconds: job.attempt_count <= 1 ? 5 : 20 });
    return result === 'queued' ? 'queued' : 'failed';
  }
}

export async function processNextGddResourceJob(input: { serviceClient: SupabaseClient; workerId: string }, dependencies: Dependencies = defaults) {
  const job = await dependencies.claim(input.serviceClient, input.workerId);
  if (!job) return { claimed: false as const };
  const status = await processClaimedGddResourceJob({ ...input, job }, dependencies);
  return { claimed: true as const, jobId: job.id, status };
}
