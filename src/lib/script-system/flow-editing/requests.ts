import { z } from 'zod';
import type { FlowEdit } from './edit';
const target = z.discriminatedUnion('kind', [z.object({ kind: z.literal('row'), rowId: z.string().uuid() }).strict(), z.object({ kind: z.literal('end') }).strict(), z.object({ kind: z.literal('sequence') }).strict()]);
const optionTarget = z.union([z.object({ kind: z.literal('row'), rowId: z.string().uuid() }).strict(), z.object({ kind: z.literal('end') }).strict()]);
const edit = z.discriminatedUnion('type', [
  z.object({ type: z.literal('outlet'), rowId: z.string().uuid(), target }).strict(),
  z.object({ type: z.literal('option'), rowId: z.string().uuid(), optionIndex: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), text: z.string().trim().min(1).max(10000), commands: z.string().max(10000).optional(), target: optionTarget }).strict(),
  z.object({ type: z.literal('disconnect-option'), rowId: z.string().uuid(), optionIndex: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict(),
  z.object({ type: z.literal('delete-option'), rowId: z.string().uuid(), optionIndex: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict(),
]);
const request = z.object({ expectedFingerprint: z.string().regex(/^[a-f0-9]{32}$/), requestId: z.string().uuid(), edits: z.array(edit).min(1).max(100) }).strict();
export function parseFlowRequest(value: unknown): { expectedFingerprint: string; requestId: string; edits: FlowEdit[] } {
  return request.parse(value) as { expectedFingerprint: string; requestId: string; edits: FlowEdit[] };
}
