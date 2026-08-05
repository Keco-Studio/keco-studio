import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { AgentTool, ToolContext, ToolResult } from '../types';
import { StoryGraphPatchSchema, type StoryGraphPatch } from '@/lib/story-graph/patchSchema';
import {
  applyNormalizedStoryGraphPatch,
  applyStoryGraphPatch,
  type NormalizedStoryGraphPatch,
} from '@/lib/story-graph/patchEngine';
import { updatePlotPlanAfterPatch } from '@/lib/story-graph/plotPlanUpdater';
import { validateEditableStoryGraph } from '@/lib/story-graph/validator';
import { buildStoryGraphEditPreview } from '@/lib/story-graph/preview';
import {
  loadStoryGraphSnapshot,
  type StoryGraphExpectedSnapshot,
  type StoryGraphSnapshot,
} from '@/lib/story-graph/snapshotReader';
import { encodeEditableStoryRows } from '@/lib/story-graph/rowCodec';
import {
  applyStoryGraphMutation,
  StoryGraphWriteError,
  type StoryGraphAssetMutation,
  type StoryGraphMutation,
} from '@/lib/story-graph/atomicWriter';

const ParamsSchema = StoryGraphPatchSchema.extend({
  libraryId: z.string().uuid().optional(),
  libraryName: z.string().trim().min(1).max(200).optional(),
}).strict();

type ParsedParams = z.infer<typeof ParamsSchema>;

const InternalSchema = z.object({
  type: z.literal('story_graph_edit_internal'),
  libraryId: z.string().uuid(),
  projectId: z.string().uuid(),
  canonicalParams: z.unknown(),
  normalizedPatch: z.unknown(),
  expectedSnapshot: z.unknown(),
  approvalSignature: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

type StoryGraphEditInternal = {
  type: 'story_graph_edit_internal';
  libraryId: string;
  projectId: string;
  canonicalParams: unknown;
  normalizedPatch: NormalizedStoryGraphPatch;
  expectedSnapshot: StoryGraphExpectedSnapshot;
  approvalSignature: string;
};

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }
  try {
    const snapshot = await loadSnapshot(parsed.data, ctx);
    const applied = applyStoryGraphPatch(snapshot.graph, patchFromParams(parsed.data));
    applied.graph.plotPlan = updatePlotPlanAfterPatch(
      snapshot.graph.plotPlan,
      applied.graph,
      applied.changes
    );
    const afterValidation = validateEditableStoryGraph(applied.graph);
    const mutation = buildMutation(snapshot, applied.graph);
    const preview = buildStoryGraphEditPreview({
      libraryId: snapshot.libraryId,
      libraryName: snapshot.libraryName,
      before: snapshot.graph,
      after: applied.graph,
      changes: applied.changes,
      addedFields: mutation.newFields.map((field) => field.label),
      beforeValidation: snapshot.validation,
      afterValidation,
    });
    const unsigned = {
      type: 'story_graph_edit_internal' as const,
      libraryId: snapshot.libraryId,
      projectId: snapshot.projectId,
      canonicalParams: canonicalParams(parsed.data),
      normalizedPatch: applied.normalizedPatch,
      expectedSnapshot: snapshot.expectedSnapshot,
    };
    return {
      success: true,
      displayHint: 'skill_preview',
      data: preview,
      internalData: {
        ...unsigned,
        approvalSignature: await sign(unsigned, ctx),
      },
    };
  } catch (error) {
    return failure(error);
  }
}

async function executeImport(
  previewResult: ToolResult,
  params: unknown,
  ctx: ToolContext
): Promise<ToolResult> {
  const parsedParams = ParamsSchema.safeParse(params);
  const parsedInternal = InternalSchema.safeParse(previewResult.internalData);
  if (!parsedParams.success || !parsedInternal.success) {
    return changedPayload();
  }
  const internal = parsedInternal.data as StoryGraphEditInternal;
  const unsigned = {
    type: internal.type,
    libraryId: internal.libraryId,
    projectId: internal.projectId,
    canonicalParams: internal.canonicalParams,
    normalizedPatch: internal.normalizedPatch,
    expectedSnapshot: internal.expectedSnapshot,
  };
  if (
    internal.projectId !== ctx.projectId
    || JSON.stringify(canonicalParams(parsedParams.data))
      !== JSON.stringify(internal.canonicalParams)
    || !(await validSignature(unsigned, internal.approvalSignature, ctx))
  ) {
    return changedPayload();
  }

  try {
    const snapshot = await loadStoryGraphSnapshot(ctx.supabase, {
      projectId: ctx.projectId,
      userId: ctx.userId,
      accessCache: ctx.accessCache,
      libraryId: internal.libraryId,
    });
    if (JSON.stringify(snapshot.expectedSnapshot) !== JSON.stringify(internal.expectedSnapshot)) {
      return {
        success: false,
        error: 'The Script changed after this edit was proposed. Read the graph and preview again.',
        data: { code: 'STORY_GRAPH_CONFLICT' },
      };
    }
    const applied = applyNormalizedStoryGraphPatch(snapshot.graph, internal.normalizedPatch);
    applied.graph.plotPlan = updatePlotPlanAfterPatch(
      snapshot.graph.plotPlan,
      applied.graph,
      applied.changes
    );
    const validation = validateEditableStoryGraph(applied.graph);
    const mutation = buildMutation(snapshot, applied.graph);
    const write = await applyStoryGraphMutation(
      ctx.supabase,
      snapshot.libraryId,
      mutation
    );
    return {
      success: true,
      displayHint: 'text',
      data: {
        libraryId: snapshot.libraryId,
        libraryName: snapshot.libraryName,
        updatedAt: write.updatedAt,
        nodeCount: validation.summary.nodeCount,
        edgeCount: validation.summary.edgeCount,
        endingCount: validation.summary.endingCount,
        warnings: validation.warnings,
      },
      invalidations: [{
        type: 'library',
        id: snapshot.libraryId,
        projectId: snapshot.projectId,
      }],
    };
  } catch (error) {
    return failure(error);
  }
}

async function loadSnapshot(params: ParsedParams, ctx: ToolContext) {
  return loadStoryGraphSnapshot(ctx.supabase, {
    projectId: ctx.projectId,
    userId: ctx.userId,
    accessCache: ctx.accessCache,
    libraryId: params.libraryId,
    libraryName: params.libraryName,
    currentLibraryId: ctx.currentLibraryId,
  });
}

function patchFromParams(params: ParsedParams): StoryGraphPatch {
  return { operations: params.operations } as StoryGraphPatch;
}

function canonicalParams(params: ParsedParams): unknown {
  return {
    libraryId: params.libraryId ?? null,
    libraryName: params.libraryName ?? null,
    operations: params.operations,
  };
}

function buildMutation(
  snapshot: StoryGraphSnapshot,
  graph: StoryGraphSnapshot['graph']
): StoryGraphMutation {
  const encodedBefore = encodeEditableStoryRows(snapshot.graph);
  const encodedAfter = encodeEditableStoryRows(graph);
  const fieldIdByLabel = new Map(snapshot.fieldIdByLabel);
  const newFields: StoryGraphMutation['newFields'] = [];
  let nextOrder = Math.max(-1, ...snapshot.fields.map((field) => field.orderIndex)) + 1;
  const missingOptionFields = new Set<string>();
  for (const row of encodedAfter) {
    for (const label of Object.keys(row.values)) {
      if (/^Option[0-9](?:_Next|_Commands)?$/.test(label) && !fieldIdByLabel.has(label)) {
        missingOptionFields.add(label);
      }
    }
  }
  [...missingOptionFields].sort(optionFieldOrder).forEach((label) => {
    const id = randomUUID();
    fieldIdByLabel.set(label, id);
    newFields.push({ id, label, orderIndex: nextOrder });
    nextOrder += 1;
  });

  const beforeByAsset = new Map(encodedBefore.flatMap((row) => (
    row.assetId ? [[row.assetId, row] as const] : []
  )));
  const assetById = new Map(snapshot.assets.map((asset) => [asset.id, asset]));
  const assetInserts: StoryGraphAssetMutation[] = [];
  const assetUpdates: StoryGraphAssetMutation[] = [];

  for (const row of encodedAfter) {
    const node = graph.nodes.find((candidate) => candidate.rowIndex === row.rowIndex)!;
    const values = fieldValues(row.values, fieldIdByLabel);
    if (!row.assetId) {
      assetInserts.push({
        id: randomUUID(),
        name: node.label,
        rowIndex: row.rowIndex,
        values,
      });
      continue;
    }
    const before = beforeByAsset.get(row.assetId);
    const asset = assetById.get(row.assetId);
    if (!before || !asset) throw new Error(`Missing existing Script row ${row.assetId}`);
    if (
      before.rowIndex !== row.rowIndex
      || JSON.stringify(before.values) !== JSON.stringify(row.values)
    ) {
      assetUpdates.push({
        id: row.assetId,
        name: asset.name,
        rowIndex: row.rowIndex,
        values,
      });
    }
  }
  return {
    expectedSnapshot: snapshot.expectedSnapshot,
    newFields,
    assetInserts,
    assetUpdates,
    plotPlan: graph.plotPlan,
  };
}

function fieldValues(
  namedValues: Record<string, string>,
  fieldIdByLabel: Map<string, string>
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [label, value] of Object.entries(namedValues)) {
    const fieldId = fieldIdByLabel.get(label);
    if (fieldId) values[fieldId] = value;
  }
  return values;
}

function optionFieldOrder(left: string, right: string): number {
  const parse = (value: string) => {
    const match = /^Option(\d+)(|_Next|_Commands)$/.exec(value)!;
    return [Number(match[1]), { '': 0, _Next: 1, _Commands: 2 }[match[2]]];
  };
  const [leftIndex, leftKind] = parse(left);
  const [rightIndex, rightKind] = parse(right);
  return leftIndex - rightIndex || leftKind - rightKind;
}

async function sign(
  value: Omit<StoryGraphEditInternal, 'approvalSignature'>,
  ctx: ToolContext
): Promise<string> {
  const { getAgentConfirmationSigningSecret } = await import(
    '@/lib/server/agentConfirmationSigning'
  );
  return createHmac('sha256', getAgentConfirmationSigningSecret())
    .update(signaturePayload(value, ctx), 'utf8')
    .digest('hex');
}

async function validSignature(
  value: Omit<StoryGraphEditInternal, 'approvalSignature'>,
  signature: string,
  ctx: ToolContext
): Promise<boolean> {
  const expected = Buffer.from(await sign(value, ctx), 'hex');
  const provided = Buffer.from(signature, 'hex');
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

function signaturePayload(
  value: Omit<StoryGraphEditInternal, 'approvalSignature'>,
  ctx: ToolContext
): string {
  return JSON.stringify([
    'story-graph-edit-v1',
    ctx.userId,
    ctx.conversationId ?? null,
    ctx.projectId,
    value.libraryId,
    value.projectId,
    value.canonicalParams,
    value.normalizedPatch,
    value.expectedSnapshot,
  ]);
}

function changedPayload(): ToolResult {
  return {
    success: false,
    error: 'The approved story graph edit payload changed.',
  };
}

function failure(error: unknown): ToolResult {
  if (error instanceof StoryGraphWriteError) {
    return { success: false, error: error.message, data: { code: error.code } };
  }
  const value = error as { code?: unknown; message?: unknown };
  return {
    success: false,
    error: typeof value?.message === 'string' ? value.message : 'Unable to edit story graph.',
    ...(typeof value?.code === 'string' ? { data: { code: value.code } } : {}),
  };
}

const operationSchemas = [
  {
    type: 'object', additionalProperties: false,
    properties: {
      type: { const: 'create_node' },
      node: {
        type: 'object', additionalProperties: false,
        properties: {
          label: { type: 'string' },
          nodeType: { type: 'string', enum: ['dialogue', 'narration', 'scene', 'system'] },
          content: { type: 'string' },
          speaker: { type: 'string' },
          plotTitle: { type: 'string' },
          nextLabel: { type: 'string' },
        },
        required: ['label', 'nodeType', 'content'],
      },
      insertAfterLabel: { type: 'string' },
    },
    required: ['type', 'node'],
  },
  ...(['add_choice', 'redirect_choice', 'remove_choice', 'set_next', 'set_end'] as const)
    .map((type) => ({
      type: 'object',
      additionalProperties: false,
      properties: {
        type: { const: type },
        fromLabel: { type: 'string' },
        ...(type === 'add_choice' ? {
          text: { type: 'string' }, targetLabel: { type: 'string' }, commands: { type: 'string' },
        } : {}),
        ...(type === 'redirect_choice' ? {
          optionIndex: { type: 'number' }, targetLabel: { type: 'string' },
        } : {}),
        ...(type === 'remove_choice' ? { optionIndex: { type: 'number' } } : {}),
        ...(type === 'set_next' ? { targetLabel: { type: 'string' } } : {}),
      },
      required: [
        'type', 'fromLabel',
        ...(type === 'add_choice' ? ['text', 'targetLabel'] : []),
        ...(type === 'redirect_choice' ? ['optionIndex', 'targetLabel'] : []),
        ...(type === 'remove_choice' ? ['optionIndex'] : []),
        ...(type === 'set_next' ? ['targetLabel'] : []),
      ],
    })),
];

export const proposeStoryGraphEdit: AgentTool = {
  name: 'propose_story_graph_edit',
  description:
    'Preview and atomically edit the executable graph of a document-derived Script. Always call read_story_graph first and use its stable labels. Supports creating nodes, adding/redirecting/removing choices, setting ordinary successors, and setting endings. Removing a choice never deletes downstream content.',
  category: 'write',
  confirmationMode: 'post_preview',
  confirmationPolicy: 'mode',
  requiredPermission: 'editor',
  parameters: {
    type: 'object',
    properties: {
      libraryId: { type: 'string', format: 'uuid' },
      libraryName: { type: 'string', minLength: 1, maxLength: 200 },
      operations: {
        type: 'array', minItems: 1, maxItems: 50,
        items: { oneOf: operationSchemas },
      },
    },
    required: ['operations'],
    additionalProperties: false,
  },
  execute,
  executeImport,
};

