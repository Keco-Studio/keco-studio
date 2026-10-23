import type { GameRuleDomain, GameRulesKernel } from '@/lib/game-design-system/ruleSchema';

const requiredDomains = [
  'player',
  'objective',
  'action',
  'object_state',
  'sequence',
  'resource_cost',
  'resolution_feedback',
  'fallback',
] as const satisfies readonly GameRuleDomain[];

export function buildGameRulesKernelFixture(input: {
  genres?: string[];
  philosophies?: string[];
  suitableFor?: string;
  extraRules?: GameRulesKernel['rules'];
} = {}): GameRulesKernel {
  return {
    schemaVersion: 2,
    genres: input.genres ?? ['Strategy'],
    philosophies: input.philosophies ?? ['Readable Systems'],
    suitableFor: input.suitableFor ?? 'Tactical games',
    rules: [
      ...requiredDomains.map((domain) => ({
        id: `required-${domain.replaceAll('_', '-')}`,
        domain,
        kind: 'constraint' as const,
        title: `${domain} rule`,
        statement: `Define ${domain} runtime behavior.`,
        appliesWhen: 'Resolving gameplay.',
        severity: 'required' as const,
      })),
      ...(input.extraRules ?? []),
    ],
    tableGuidance: [],
  };
}
