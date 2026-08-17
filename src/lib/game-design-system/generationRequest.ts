import { z } from 'zod';
import { gameArtStyleInputSchema } from '@/lib/game-art-style/schema';
import { gameDesignSystemTitleSchema } from './ruleSchema';

export const gameDesignGenerationRequestSchema = z.object({
  title: gameDesignSystemTitleSchema,
  genres: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  philosophies: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  description: z.string().trim().max(4000).optional(),
  suitableFor: z.string().trim().max(500).optional(),
  baseSystemId: z.string().uuid().optional(),
  pastedMarkdown: z.string().max(20_000).optional(),
  references: z.array(z.object({
    kind: z.enum(['document', 'table']),
    projectId: z.string().uuid(),
    resourceId: z.string().uuid(),
  }).strict()).max(10).default([]),
  referenceGames: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    reference: z.string().trim().max(500),
    avoid: z.string().trim().max(500),
  }).strict()).max(10).default([]),
  artStyle: gameArtStyleInputSchema,
}).strict();

export type GameDesignGenerationRequestInput = z.input<typeof gameDesignGenerationRequestSchema>;
export type NormalizedGameDesignGenerationRequest = z.output<typeof gameDesignGenerationRequestSchema>;
