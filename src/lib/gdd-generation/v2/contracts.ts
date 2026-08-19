import type { GameDesignDocument, GameDesignRuleSet } from '@/lib/game-design-system/ruleSchema';
import type { GameDesignSourceSnapshot } from '@/lib/services/gameDesignSystemService';
import { z } from 'zod';

export const reviewSchema = z.object({
  version: z.literal(2),
  summary: z.string().trim().min(1).max(4_000),
  issues: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    severity: z.enum(['info', 'warning', 'error']),
    sectionId: z.string().trim().min(1).max(120).optional(),
    message: z.string().trim().min(1).max(1_500),
    repairInstruction: z.string().trim().min(1).max(1_500).optional(),
  }).strict()).max(200),
  status: z.enum(['pass', 'repair']).optional(),
  repairRound: z.number().int().min(0).max(2).optional(),
}).strict();

export type ReviewV2 = z.infer<typeof reviewSchema>;

export const gddGenerationModeSchema = z.enum(['quick', 'professional']);
export type GddGenerationMode = z.infer<typeof gddGenerationModeSchema>;

export type GddGenerationRequestV2 = {
  contractVersion: 2;
  mode: GddGenerationMode;
  creativeBrief?: string;
  language: 'zh-CN';
  projectId: string;
  projectName: string;
  designSystemId: string;
  versionId: string;
  versionNumber: number;
  systemTitle: string;
  rules: GameDesignRuleSet;
  designDocument: GameDesignDocument;
  projectSources: GameDesignSourceSnapshot[];
};

export function isGddGenerationRequestV2(value: unknown): value is GddGenerationRequestV2 {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return candidate.contractVersion === 2
    && (candidate.mode === 'quick' || candidate.mode === 'professional')
    && typeof candidate.projectId === 'string'
    && typeof candidate.versionId === 'string';
}
