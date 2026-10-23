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

function findRuleSetSchema(schemaVersion: number): ObjectSchema {
  const root = gameDesignSystemVersionRequestToolSchema as ObjectSchema;
  const alternatives = root.properties?.rules?.anyOf ?? [];
  const ruleSet = alternatives.find((alternative) => alternative.properties?.schemaVersion?.const === schemaVersion);
  if (!ruleSet) throw new Error(`Missing schemaVersion ${schemaVersion} rule-set alternative.`);
  return ruleSet;
}

describe('Game Design System version Agent schema', () => {
  it('accepts the v2 Game Rules Kernel with required domains while retaining legacy v1', () => {
    const v2 = findRuleSetSchema(2);
    const v1 = findRuleSetSchema(1);
    const v2Rule = v2.properties?.rules?.items;

    expect(v2.additionalProperties).toBe(false);
    expect(v2.required).toEqual(['schemaVersion', 'genres', 'philosophies', 'suitableFor', 'rules', 'tableGuidance']);
    expect(v2Rule?.additionalProperties).toBe(false);
    expect(v2Rule?.properties).toHaveProperty('domain');
    expect(v2Rule?.required).toContain('domain');
    expect(v2.description).toContain('player');
    expect(v2.description).toContain('fallback');
    expect(v1.additionalProperties).toBe(false);
    expect(v1.properties?.schemaVersion?.const).toBe(1);
  });
});
