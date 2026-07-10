/**
 * import_script converts an exact user-message source span into audited Story IR,
 * then imports the validated document without reparsing model text.
 */

import { z } from 'zod';
import type { RoleMap } from '@/lib/script-parser';
import type { ImportProgressEvent } from '@/lib/story-ir/schema';
import { importStoryDocument } from '@/lib/services/scriptImportService';
import { resolveStoryForImport } from '@/lib/services/scriptConversionService';
import { getFolderRow } from '../data-access';
import { resolveAgentImportSource } from '../source-resolver';
import type { AgentTool, ToolContext, ToolResult } from '../types';

const ParamsSchema = z.object({
  libraryName: z.string().min(1),
  folderId: z.string().uuid({ message: 'folderId must be a valid UUID' }),
  sourceText: z.string().min(1).optional(),
  sourceStart: z.number().int().nonnegative().optional(),
  sourceEnd: z.number().int().positive().optional(),
  characterMapping: z.record(z.number()).optional(),
});

type Params = z.infer<typeof ParamsSchema>;

function toRoleMap(mapping?: Record<string, number>): RoleMap {
  const roleMap: RoleMap = {};
  if (!mapping) return roleMap;
  for (const [name, type] of Object.entries(mapping)) {
    roleMap[name] = { id: '', type };
  }
  return roleMap;
}

async function validateParamsAndFolder(
  params: unknown,
  ctx: ToolContext
): Promise<{ data?: Params; error?: ToolResult }> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { error: { success: false, error: `Invalid parameters: ${parsed.error.message}` } };
  }
  try {
    const folder = await getFolderRow(ctx.supabase, parsed.data.folderId);
    if (!folder || folder.project_id !== ctx.projectId) {
      return {
        error: {
          success: false,
          error: `Folder "${parsed.data.folderId}" not found in this project. Ask the user which folder to import into.`,
        },
      };
    }
  } catch {
    return {
      error: {
        success: false,
        error: `Folder "${parsed.data.folderId}" is not accessible. Ask the user which folder to import into.`,
      },
    };
  }
  return { data: parsed.data };
}

async function* executeStream(
  params: unknown,
  ctx: ToolContext
): AsyncGenerator<ImportProgressEvent, ToolResult> {
  const validated = await validateParamsAndFolder(params, ctx);
  if (!validated.data) return validated.error!;
  const data = validated.data;

  let source;
  try {
    source = resolveAgentImportSource(data, ctx);
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }

  const queue = new ProgressQueue();
  const resolutionPromise = resolveStoryForImport(source.content, {
    sourceId: source.sourceId,
    roleMap: toRoleMap(data.characterMapping),
    onProgress: (event) => queue.push(event),
  })
    .then((resolved) => ({ resolved }))
    .catch((error: unknown) => ({ error }))
    .finally(() => queue.close());

  for await (const progress of queue) yield progress;
  const resolution = await resolutionPromise;
  if ('error' in resolution) {
    return {
      success: false,
      error: resolution.error instanceof Error
        ? resolution.error.message
        : 'Conversion failed.',
    };
  }

  yield { phase: 'table_compile', message: 'Compiling script table' };
  yield { phase: 'database_write', message: 'Writing script library' };
  try {
    const result = await importStoryDocument(ctx.supabase, {
      userId: ctx.userId,
      projectId: ctx.projectId,
      folderId: data.folderId,
      libraryName: data.libraryName,
      document: resolution.resolved.document,
      fileName: `${data.libraryName}.txt`,
    });
    return {
      success: true,
      displayHint: 'text',
      data: {
        libraryId: result.libraryId,
        libraryName: data.libraryName,
        rowCount: result.rowCount,
        fieldCount: result.fieldCount,
      },
      invalidateCache: [result.libraryId],
    };
  } catch (error) {
    return { success: false, error: (error as Error).message || 'Import failed.' };
  }
}

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const iterator = executeStream(params, ctx);
  while (true) {
    const step = await iterator.next();
    if (step.done) return step.value;
  }
}

class ProgressQueue implements AsyncIterable<ImportProgressEvent> {
  private events: ImportProgressEvent[] = [];
  private waiting: (() => void) | undefined;
  private closed = false;

  push(event: ImportProgressEvent): void {
    this.events.push(event);
    this.waiting?.();
    this.waiting = undefined;
  }

  close(): void {
    this.closed = true;
    this.waiting?.();
    this.waiting = undefined;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<ImportProgressEvent> {
    while (!this.closed || this.events.length > 0) {
      if (this.events.length > 0) {
        yield this.events.shift()!;
        continue;
      }
      await new Promise<void>((resolve) => {
        this.waiting = resolve;
      });
    }
  }
}

export const importScript: AgentTool = {
  name: 'import_script',
  description:
    'Convert an exact user-message source span into audited Story IR and import it as a script library. The tool, not the agent, parses and repairs story structure.',
  category: 'write',
  confirmationMode: 'pre_execute',
  confirmationRequired: false,
  requiredPermission: 'editor',
  parameters: {
    type: 'object',
    properties: {
      libraryName: { type: 'string', description: 'Name for the new library' },
      folderId: { type: 'string', format: 'uuid', description: 'Target folder UUID. If unknown, ask the user.' },
      sourceStart: { type: 'integer', minimum: 0, description: 'Inclusive character offset of the exact story span in the current user message' },
      sourceEnd: { type: 'integer', minimum: 1, description: 'Exclusive character offset of the exact story span in the current user message' },
      sourceText: { type: 'string', description: 'Legacy fallback only. Never rewrite or normalize this value.' },
      characterMapping: {
        type: 'object',
        description: 'Optional mapping of character names to dialogue types',
        additionalProperties: { type: 'number', enum: [1, 2, 3, 5] },
      },
    },
    required: ['libraryName', 'folderId'],
  },
  execute,
  executeStream,
};
