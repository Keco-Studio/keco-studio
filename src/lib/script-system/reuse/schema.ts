import { z } from 'zod';

export const SCRIPT_REUSE_MAX_BYTES = 1024 * 1024;
export const SCRIPT_REUSE_MAX_ROWS = 5000;
const id = z.string().min(1).max(200);
const key = z.string().min(1).max(200).refine(value => !['__proto__', 'constructor', 'prototype'].includes(value));
const json: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(), z.array(json), z.record(key, json),
]));
const field = z.object({ semanticKey: key, valueType: z.string().min(1), config: z.record(key, json) }).strict();
const row = z.object({ localId: id, values: z.record(key, json) }).strict();
const block = z.object({ localId: id, rowIds: z.array(id).min(1) }).strict();
const node = block.extend({ title: z.string() }).strict();
const resource = z.object({ rowId: id, fieldKey: key, value: json }).strict();
const edge = z.object({
  localId: id, fromRowId: id, toRowId: id.optional(), externalTarget: id.optional(),
  kind: z.enum(['sequence', 'jump', 'option']), optionIndex: z.number().int().nonnegative().optional(),
}).strict().refine(value => Boolean(value.toRowId) !== Boolean(value.externalTarget), 'Exactly one edge destination required')
  .refine(value => (value.kind === 'option') === (value.optionIndex !== undefined), 'Option index mismatch');

export const ScriptReuseSourceSchema = z.object({
  projectId: id, libraryId: id, fingerprint: id,
  fields: z.array(field).min(1), rows: z.array(row).min(1).max(SCRIPT_REUSE_MAX_ROWS),
  blocks: z.array(block), nodes: z.array(node), resourceRefs: z.array(resource),
}).strict();
export type ScriptReuseSource = z.infer<typeof ScriptReuseSourceSchema>;
export type ScriptReuseSelection = { kind: 'all' } | { kind: 'rows'; rowIds: string[] } | { kind: 'nodes'; nodeIds: string[] };
export const ScriptReuseSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({ kind: z.literal('rows'), rowIds: z.array(id).min(1).max(SCRIPT_REUSE_MAX_ROWS) }).strict(),
  z.object({ kind: z.literal('nodes'), nodeIds: z.array(id).min(1).max(SCRIPT_REUSE_MAX_ROWS) }).strict(),
]);
export const ScriptReuseSnapshotSchema = z.object({
  version: z.literal(1), projectId: id,
  fields: z.array(field).min(1), rows: z.array(row).min(1).max(SCRIPT_REUSE_MAX_ROWS),
  blocks: z.array(block), nodes: z.array(node), edges: z.array(edge),
  entryRowIds: z.array(id).min(1), resourceRefs: z.array(resource), variableNames: z.array(z.string()),
  provenance: z.object({ libraryId: id, fingerprint: id }).strict(),
}).strict();
export type ScriptReuseSnapshot = z.infer<typeof ScriptReuseSnapshotSchema>;
export type ScriptReuseEdge = ScriptReuseSnapshot['edges'][number];

export function assertReuseSize(input: unknown): void {
  if (new TextEncoder().encode(JSON.stringify(input)).length > SCRIPT_REUSE_MAX_BYTES) {
    throw new Error('Script snapshot exceeds 1 MiB');
  }
}

export function assertUnique(values: string[], description: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${description}`);
}

export function parseScriptReuseSnapshot(input: unknown): ScriptReuseSnapshot {
  assertReuseSize(input);
  const parsed = ScriptReuseSnapshotSchema.parse(input);
  const rows = new Set(parsed.rows.map(item => item.localId));
  const fields = new Set(parsed.fields.map(item => item.semanticKey));
  assertUnique([...parsed.rows.map(item => item.localId)], 'row IDs');
  assertUnique(parsed.fields.map(item => item.semanticKey), 'fields');
  assertUnique(parsed.edges.map(item => item.localId), 'edge IDs');
  assertUnique(parsed.entryRowIds, 'entries');
  for (const collection of [parsed.blocks, parsed.nodes]) {
    assertUnique(collection.map(item => item.localId), 'group IDs');
    for (const group of collection) {
      assertUnique(group.rowIds, 'group rows');
      if (group.rowIds.some(rowId => !rows.has(rowId))) throw new Error('Unknown group row');
    }
  }
  for (const item of parsed.rows) {
    if (Object.keys(item.values).some(fieldKey => !fields.has(fieldKey))) throw new Error('Unknown field');
  }
  if (parsed.entryRowIds.some(rowId => !rows.has(rowId))) throw new Error('Unknown entry');
  for (const item of parsed.edges) {
    if (!rows.has(item.fromRowId) || (item.toRowId && !rows.has(item.toRowId))) throw new Error('Unknown edge row');
    if (item.externalTarget && rows.has(item.externalTarget)) throw new Error('External target is internal');
  }
  for (const item of parsed.resourceRefs) {
    if (!rows.has(item.rowId) || !fields.has(item.fieldKey)) throw new Error('Unknown resource reference');
  }
  return parsed;
}
