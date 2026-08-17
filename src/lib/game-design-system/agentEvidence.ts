import { z } from 'zod';

export interface GameDesignPolicyContext {
  systemId: string;
  versionId: string;
  version: number;
  includedRuleIds: string[];
  omittedRuleIds: string[];
}

export interface GameDesignRuleEvidence extends GameDesignPolicyContext {
  declaredRuleIds: string[];
  invalidRuleIds: string[];
  declarationStatus: 'declared' | 'missing' | 'invalid';
}

const declarationPattern = /^Applied rules:\s*(.+)$/i;
const ruleIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const gameDesignRuleEvidenceSchema = z.object({
  systemId: z.string().min(1),
  versionId: z.string().min(1),
  version: z.number().int().positive(),
  includedRuleIds: z.array(z.string()),
  omittedRuleIds: z.array(z.string()),
  declaredRuleIds: z.array(z.string()),
  invalidRuleIds: z.array(z.string()),
  declarationStatus: z.enum(['declared', 'missing', 'invalid']),
}).strict();

export function parseGameDesignRuleEvidence(value: unknown): GameDesignRuleEvidence | undefined {
  const parsed = gameDesignRuleEvidenceSchema.safeParse(value);
  return parsed.success ? parsed.data as GameDesignRuleEvidence : undefined;
}

export function buildGameDesignRuleEvidence(
  answer: string,
  policy: GameDesignPolicyContext,
): GameDesignRuleEvidence {
  const finalLine = answer.trimEnd().split(/\r?\n/).at(-1)?.trim() ?? '';
  const match = declarationPattern.exec(finalLine);
  if (!match) {
    return {
      ...policy,
      declaredRuleIds: [],
      invalidRuleIds: [],
      declarationStatus: 'missing',
    };
  }

  const available = new Set(policy.includedRuleIds);
  const rawIds = (match[1] ?? '').split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const uniqueIds = [...new Set(rawIds)];
  if (uniqueIds.length === 0) {
    return {
      ...policy,
      declaredRuleIds: [],
      invalidRuleIds: [],
      declarationStatus: 'missing',
    };
  }
  const declaredRuleIds = uniqueIds.filter((id) => ruleIdPattern.test(id) && available.has(id));
  const invalidRuleIds = uniqueIds.filter((id) => !ruleIdPattern.test(id) || !available.has(id));

  return {
    ...policy,
    declaredRuleIds,
    invalidRuleIds,
    declarationStatus: invalidRuleIds.length > 0 ? 'invalid' : 'declared',
  };
}
