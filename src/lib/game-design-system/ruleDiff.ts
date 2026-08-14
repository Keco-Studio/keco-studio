import type { GameDesignRuleSet } from './ruleSchema';

export type GameDesignRuleDiff = {
  added: string[];
  removed: string[];
  changed: string[];
  conflicts: Array<{ ruleId: string; reason: string }>;
};

export function findReintroducedRuleIds(
  parent: GameDesignRuleSet,
  next: GameDesignRuleSet,
  ancestors: GameDesignRuleSet[],
): string[] {
  const parentIds = new Set(parent.rules.map((rule) => rule.id));
  const historicalIds = new Set(ancestors.flatMap((ruleSet) => ruleSet.rules.map((rule) => rule.id)));
  return next.rules
    .map((rule) => rule.id)
    .filter((id) => !parentIds.has(id) && historicalIds.has(id))
    .sort();
}

export function diffRuleSets(parent: GameDesignRuleSet, next: GameDesignRuleSet): GameDesignRuleDiff {
  const previousById = new Map(parent.rules.map((rule) => [rule.id, rule]));
  const nextById = new Map(next.rules.map((rule) => [rule.id, rule]));
  const added = [...nextById.keys()].filter((id) => !previousById.has(id)).sort();
  const removed = [...previousById.keys()].filter((id) => !nextById.has(id)).sort();
  const changed: string[] = [];
  const conflicts: GameDesignRuleDiff['conflicts'] = [];

  [...nextById.keys()].sort().forEach((id) => {
    const previous = previousById.get(id);
    const current = nextById.get(id);
    if (!previous || !current) return;
    if (JSON.stringify(previous) !== JSON.stringify(current)) changed.push(id);
    if (previous.kind !== current.kind) {
      conflicts.push({ ruleId: id, reason: `Rule kind changed from ${previous.kind} to ${current.kind}.` });
    }
  });

  return { added, removed, changed, conflicts };
}
