import { z } from 'zod';

const entityIdSchema = z.string().trim().min(1).max(120).regex(/^[a-z][a-z0-9]*(?:[-.][a-z0-9]+)*$/);
const numericRefSchema = z.string().trim().min(1).max(120).regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/);
const boundedText = (max: number) => z.string().trim().min(1).max(max);

function rejectDangerousKeys(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    value.forEach(rejectDangerousKeys);
    return value;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new Error(`Unsafe JSON key: ${key}`);
    }
    rejectDangerousKeys(child);
  }
  return value;
}

function ensureUniqueIds<T>(items: readonly T[], getId: (item: T, index: number) => string, label: string): void {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const id = getId(item, index);
    if (seen.has(id)) {
      throw new Error(`Duplicate ${label} ID: ${id}`);
    }
    seen.add(id);
  });
}

function ensureParentDepthHierarchy<T extends { id: string; depth: number; parentId?: string | null }>(
  items: readonly T[],
  label: string,
): void {
  const byId = new Map(items.map((item) => [item.id, item] as const));
  for (const item of items) {
    const parentId = item.parentId ?? undefined;
    if (item.depth === 0) {
      if (parentId) throw new Error(`${label} ${item.id} at depth 0 cannot declare a parent.`);
      continue;
    }
    if (!parentId) throw new Error(`${label} ${item.id} at depth ${item.depth} must declare a parent.`);
    const parent = byId.get(parentId);
    if (!parent) throw new Error(`${label} ${item.id} references missing parent ${parentId}.`);
    if (parent.depth !== item.depth - 1) {
      throw new Error(`${label} ${item.id} must be exactly one level deeper than its parent ${parentId}.`);
    }
  }
}

function ensureNumericRefsKnown(refs: readonly string[] | undefined, knownIds: Set<string>, label: string): void {
  if (!refs) return;
  const unknown = refs.filter((ref) => !knownIds.has(ref));
  if (unknown.length > 0) {
    throw new Error(`${label} contains unknown numeric refs: ${unknown.join(', ')}`);
  }
}

const paragraphBlockSchema = z.object({
  kind: z.literal('paragraph'),
  id: entityIdSchema,
  text: boundedText(8_000),
}).strict();

const bulletListBlockSchema = z.object({
  kind: z.literal('bullet-list'),
  id: entityIdSchema,
  items: z.array(boundedText(1_500)).min(1).max(100),
}).strict();

const dataTableBlockSchema = z.object({
  kind: z.literal('data-table'),
  id: entityIdSchema,
  columns: z.array(boundedText(120)).min(1).max(20),
  rows: z.array(z.array(boundedText(500))).min(1).max(500),
}).strict().superRefine((value, context) => {
  value.rows.forEach((row, index) => {
    if (row.length !== value.columns.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rows', index],
        message: 'Each data-table row must have the same width as the columns array.',
      });
    }
  });
});

const formulaBlockSchema = z.object({
  kind: z.literal('formula'),
  id: entityIdSchema,
  expression: boundedText(2_000),
  numericRefs: z.array(numericRefSchema).min(1).max(20),
}).strict();

const exampleBlockSchema = z.object({
  kind: z.literal('example'),
  id: entityIdSchema,
  title: boundedText(160),
  numericRefs: z.array(numericRefSchema).min(1).max(20),
}).strict();

const flowBlockSchema = z.object({
  kind: z.literal('flow'),
  id: entityIdSchema,
  steps: z.array(z.object({
    id: entityIdSchema,
    text: boundedText(500),
  }).strict()).min(1).max(40),
}).strict().superRefine((value, context) => {
  ensureUniqueIds(value.steps, (step) => step.id, `flow step for ${value.id}`);
  if (value.steps.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['steps'],
      message: 'A flow block must contain at least one step.',
    });
  }
});

const quoteBlockSchema = z.object({
  kind: z.literal('quote'),
  id: entityIdSchema,
  text: boundedText(2_000),
  cite: boundedText(240),
}).strict();

export const typedBlockSchema = z.union([
  paragraphBlockSchema,
  bulletListBlockSchema,
  dataTableBlockSchema,
  formulaBlockSchema,
  exampleBlockSchema,
  flowBlockSchema,
  quoteBlockSchema,
]);

export type TypedBlock = z.infer<typeof typedBlockSchema>;

export function parseTypedBlockV2(value: unknown): TypedBlock {
  return typedBlockSchema.parse(rejectDangerousKeys(value));
}

export const blueprintOutlineSchema = z.object({
  version: z.literal(2),
  nodes: z.array(z.object({
    id: entityIdSchema,
    label: boundedText(160),
    depth: z.number().int().min(0).max(20),
    parentId: entityIdSchema.optional(),
    group: boundedText(80),
  }).strict()).min(1).max(200),
}).strict().superRefine((value, context) => {
  ensureUniqueIds(value.nodes, (node) => node.id, 'blueprint node');
  const byId = new Map(value.nodes.map((node) => [node.id, node] as const));
  for (const node of value.nodes) {
    if (node.depth === 0) {
      if (node.parentId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['nodes', value.nodes.indexOf(node), 'parentId'],
          message: 'Depth 0 blueprint nodes cannot declare a parent.',
        });
      }
      continue;
    }
    if (!node.parentId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nodes', value.nodes.indexOf(node), 'parentId'],
        message: 'Non-root blueprint nodes must declare a parent.',
      });
      continue;
    }
    const parent = byId.get(node.parentId);
    if (!parent) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nodes', value.nodes.indexOf(node), 'parentId'],
        message: `Missing blueprint parent: ${node.parentId}`,
      });
      continue;
    }
    if (parent.depth !== node.depth - 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nodes', value.nodes.indexOf(node), 'depth'],
        message: 'Blueprint node depth must increase by exactly one from its parent.',
      });
    }
  }
});

export const numericRegistrySchema = z.object({
  version: z.literal(2),
  entries: z.array(z.object({
    id: numericRefSchema,
    value: z.number().finite(),
    label: boundedText(160).optional(),
  }).strict()).min(1).max(500),
}).strict().superRefine((value) => {
  ensureUniqueIds(value.entries, (entry) => entry.id, 'numeric registry entry');
});

export const sectionSchema = z.object({
  id: entityIdSchema,
  title: boundedText(160),
  depth: z.number().int().min(0).max(20),
  parentId: entityIdSchema.optional(),
  group: boundedText(80).optional(),
  blocks: z.array(typedBlockSchema).max(200),
  numericRefs: z.array(numericRefSchema).max(100).default([]),
}).strict().superRefine((value, context) => {
  if (value.depth === 0) {
    if (value.parentId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['parentId'],
        message: 'Depth 0 sections cannot declare a parent.',
      });
    }
  } else if (!value.parentId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['parentId'],
      message: 'Nested sections must declare a parent.',
    });
  }
  ensureUniqueIds(value.blocks, (block) => block.id, `section block for ${value.id}`);
});

export const reviewSchema = z.object({
  version: z.literal(2),
  summary: boundedText(4_000),
  issues: z.array(z.object({
    id: entityIdSchema,
    severity: z.enum(['info', 'warning', 'error']),
    message: boundedText(1_500),
  }).strict()).max(200),
}).strict().superRefine((value) => {
  ensureUniqueIds(value.issues, (issue) => issue.id, 'review issue');
});

export const artifactsSchema = z.object({
  version: z.literal(2),
  markdown: boundedText(120_000),
  outline: blueprintOutlineSchema,
  review: reviewSchema,
}).strict();

export const documentSchema = z.object({
  version: z.literal(2),
  id: entityIdSchema,
  title: boundedText(160),
  blueprint: blueprintOutlineSchema,
  numericRegistry: numericRegistrySchema,
  sections: z.array(sectionSchema).min(1).max(200),
}).strict().superRefine((value) => {
  ensureUniqueIds(value.sections, (section) => section.id, 'section');
  const knownNumericIds = new Set(value.numericRegistry.entries.map((entry) => entry.id));
  for (const section of value.sections) {
    ensureNumericRefsKnown(section.numericRefs, knownNumericIds, `section ${section.id}`);
    for (const block of section.blocks) {
      if (block.kind === 'formula' || block.kind === 'example') {
        ensureNumericRefsKnown(block.numericRefs, knownNumericIds, `block ${block.id}`);
      }
      if (block.kind === 'data-table') {
        continue;
      }
    }
  }
});

export const generationInputV2Schema = z.object({
  version: z.literal(2),
  projectId: entityIdSchema,
  projectName: boundedText(160),
  systemTitle: boundedText(160),
  blueprint: blueprintOutlineSchema,
  numericRegistry: numericRegistrySchema,
  sections: z.array(sectionSchema).min(1).max(200),
  document: documentSchema,
  review: reviewSchema,
  artifacts: artifactsSchema,
}).strict().superRefine((value) => {
  ensureUniqueIds(value.sections, (section) => section.id, 'input section');
  const knownNumericIds = new Set(value.numericRegistry.entries.map((entry) => entry.id));
  ensureNumericRefsKnown(value.document.sections.flatMap((section) => section.numericRefs), knownNumericIds, 'document');
  for (const section of value.sections) {
    ensureNumericRefsKnown(section.numericRefs, knownNumericIds, `input section ${section.id}`);
    for (const block of section.blocks) {
      if (block.kind === 'formula' || block.kind === 'example') {
        ensureNumericRefsKnown(block.numericRefs, knownNumericIds, `input block ${block.id}`);
      }
    }
  }
});

export type BlueprintOutlineV2 = z.infer<typeof blueprintOutlineSchema>;
export type NumericRegistryV2 = z.infer<typeof numericRegistrySchema>;
export type SectionV2 = z.infer<typeof sectionSchema>;
export type ReviewV2 = z.infer<typeof reviewSchema>;
export type ArtifactsV2 = z.infer<typeof artifactsSchema>;
export type DocumentV2 = z.infer<typeof documentSchema>;
export type GddGenerationInputV2 = z.infer<typeof generationInputV2Schema>;

export function parseBlueprintOutlineV2(value: unknown): BlueprintOutlineV2 {
  return blueprintOutlineSchema.parse(rejectDangerousKeys(value));
}

export function parseNumericRegistryV2(value: unknown): NumericRegistryV2 {
  return numericRegistrySchema.parse(rejectDangerousKeys(value));
}

export function parseSectionV2(value: unknown): SectionV2 {
  return sectionSchema.parse(rejectDangerousKeys(value));
}

export function parseReviewV2(value: unknown): ReviewV2 {
  return reviewSchema.parse(rejectDangerousKeys(value));
}

export function parseArtifactsV2(value: unknown): ArtifactsV2 {
  return artifactsSchema.parse(rejectDangerousKeys(value));
}

export function parseDocumentV2(value: unknown): DocumentV2 {
  return documentSchema.parse(rejectDangerousKeys(value));
}

export function parseGenerationInputV2(value: unknown): GddGenerationInputV2 {
  return generationInputV2Schema.parse(rejectDangerousKeys(value));
}

export function isGddGenerationInputV2(value: unknown): value is GddGenerationInputV2 {
  return generationInputV2Schema.safeParse(rejectDangerousKeys(value)).success;
}
