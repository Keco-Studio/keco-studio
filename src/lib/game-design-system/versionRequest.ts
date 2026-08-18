import { z } from 'zod';
import { gameArtStyleInputSchema } from '@/lib/game-art-style/schema';
import { gameDesignDocumentSchema, gameDesignRuleSetSchema } from './ruleSchema';

export const gameDesignSystemVersionIdempotencyKeySchema = z.string().uuid();

export const createGameDesignSystemVersionRequestSchema = z.object({
  parentVersionId: z.string().uuid(),
  expectedCurrentVersionId: z.string().uuid(),
  document: gameDesignDocumentSchema.optional(),
  rules: gameDesignRuleSetSchema.optional(),
  artStyle: gameArtStyleInputSchema.nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.document === undefined && value.rules === undefined && value.artStyle === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At least one version component must be supplied.',
    });
  }
});

export type CreateGameDesignSystemVersionRequest = z.input<
  typeof createGameDesignSystemVersionRequestSchema
>;

export type ParsedCreateGameDesignSystemVersionRequest = z.output<
  typeof createGameDesignSystemVersionRequestSchema
>;
