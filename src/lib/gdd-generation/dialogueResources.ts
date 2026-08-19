import { createHash } from 'node:crypto';
import { z } from 'zod';

const boundedText = (max: number) => z.string().trim().min(1).max(max);

export const dialoguePlanSchema = z.object({
  chapterKey: boundedText(120),
  title: boundedText(160),
  content: boundedText(120_000),
  hasChoices: z.boolean(),
  branchSummary: z.array(boundedText(300)).max(50),
}).strict();

export type DialoguePlan = z.infer<typeof dialoguePlanSchema>;

export type DialogueResource = DialoguePlan & {
  documentId: string;
  dialogueJobId: string;
  documentName: string;
};

export type DialogueResourceStatus = {
  dialogueJobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  scriptLibraryId?: string | null;
};

const DIALOGUE_MARKER = /<!--\s*KECO_DIALOGUE_PLAN\s*([\s\S]*?)\s*-->/i;
const DIALOGUE_MARKERS = /<!--\s*KECO_DIALOGUE_PLAN\s*([\s\S]*?)\s*-->/gi;

function deterministicUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function normalizeDialoguePlans(value: unknown): DialoguePlan[] {
  if (!Array.isArray(value)) throw new Error('Generated dialogue plan must be an array.');
  const plans = value.map((item) => dialoguePlanSchema.parse(item));
  const keys = new Set<string>();
  for (const plan of plans) {
    const key = plan.chapterKey.toLocaleLowerCase();
    if (keys.has(key)) throw new Error(`Duplicate dialogue chapter key: ${plan.chapterKey}`);
    keys.add(key);
  }
  return plans;
}

export function extractDialoguePlanMarker(raw: string): {
  markdown: string;
  plans: DialoguePlan[];
  warning: string | null;
} {
  if ([...raw.matchAll(DIALOGUE_MARKERS)].length > 1) {
    throw new Error('Multiple KECO dialogue plan markers are not allowed.');
  }
  const match = DIALOGUE_MARKER.exec(raw);
  if (!match) return { markdown: raw.trim(), plans: [], warning: null };
  const markdown = raw.replace(match[0], '').trim();
  try {
    return {
      markdown,
      plans: normalizeDialoguePlans(JSON.parse(match[1])),
      warning: null,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        markdown,
        plans: [],
        warning: 'KECO dialogue plan marker is not valid JSON.',
      };
    }
    throw error;
  }
}

export function materializeDialogueResources(
  gddJobId: string,
  plans: DialoguePlan[],
): DialogueResource[] {
  return plans.map((plan) => {
    const key = plan.chapterKey.toLocaleLowerCase();
    return {
      ...plan,
      documentId: deterministicUuid(`${gddJobId}:dialogue-document:${key}`),
      dialogueJobId: deterministicUuid(`${gddJobId}:dialogue-job:${key}`),
      documentName: `${plan.title} dialogue`,
    };
  });
}

function statusLabel(status: DialogueResourceStatus | undefined): string {
  if (!status || status.status === 'queued') return 'Generating';
  if (status.status === 'running') return 'Running';
  if (status.status === 'failed') return 'Failed - Retry';
  return 'Completed';
}

export function renderDialogueReferences(
  projectId: string,
  resources: DialogueResource[],
  statuses: DialogueResourceStatus[] = [],
): string {
  if (resources.length === 0) return '- No dialogue resources were generated.';
  const statusByJob = new Map(statuses.map((status) => [status.dialogueJobId, status]));
  return resources.map((resource) => {
    const status = statusByJob.get(resource.dialogueJobId);
    const lines = [
      `- ${resource.title}: [${resource.documentName}](/${encodeURIComponent(projectId)}/doc/${encodeURIComponent(resource.documentId)})`,
      `  - GDD dialogue job: ${resource.dialogueJobId}`,
      `  - Script: ${statusLabel(status)}`,
    ];
    if (status?.status === 'completed' && status.scriptLibraryId) {
      lines[2] += ` - [Script](/script-system/${encodeURIComponent(projectId)}/script/${encodeURIComponent(status.scriptLibraryId)})`;
    }
    return lines.join('\n');
  }).join('\n');
}
