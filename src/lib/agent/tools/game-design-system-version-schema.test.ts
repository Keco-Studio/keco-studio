import { describe, expect, it } from '@jest/globals';
import { gameDesignSystemVersionRequestToolSchema } from './game-design-system-version-schema';

type ObjectSchema = {
  type?: string;
  const?: number;
  additionalProperties?: boolean;
  description?: string;
  properties?: Record<string, ObjectSchema>;
  required?: string[];
  items?: ObjectSchema;
  anyOf?: ObjectSchema[];
};

function mutationRuleSetSchema(): ObjectSchema {
  const root = gameDesignSystemVersionRequestToolSchema as ObjectSchema;
  const ruleSet = root.properties?.rules;
  if (!ruleSet) throw new Error('Missing mutation rule-set schema.');
  return ruleSet;
}

describe('Game Design System version Agent schema', () => {
  it('accepts only the v2 Game Rules Kernel for version mutations', () => {
    const v2 = mutationRuleSetSchema();
    const v2Rule = v2.properties?.rules?.items;

    expect(v2.anyOf).toBeUndefined();
    expect(v2.properties?.schemaVersion?.const).toBe(2);
    expect(v2.additionalProperties).toBe(false);
    expect(v2.required).toEqual(['schemaVersion', 'genres', 'philosophies', 'suitableFor', 'rules', 'tableGuidance']);
    expect(v2Rule?.additionalProperties).toBe(false);
    expect(v2Rule?.properties).toHaveProperty('domain');
    expect(v2Rule?.required).toContain('domain');
    expect(v2.description).toContain('player');
    expect(v2.description).toContain('fallback');
  });
});
