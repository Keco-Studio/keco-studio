import type { JSONSchema } from '../types';

const text = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength });

const documentSchema: JSONSchema = {
  type: 'object',
  additionalProperties: false,
  description: 'Complete replacement document. Include every required field when supplying document.',
  properties: {
    gameBackground: { type: 'string', minLength: 1, maxLength: 4000 },
    designIntent: text(4000),
    playerFantasy: text(4000),
    coreLoop: text(4000),
    decisionStructure: text(4000),
    systemBoundaries: text(4000),
    progressionEconomy: text(4000),
    contentModel: text(4000),
    difficultyBalance: text(4000),
    experiencePresentation: text(4000),
  },
  required: [
    'designIntent', 'playerFantasy', 'coreLoop', 'decisionStructure',
    'systemBoundaries', 'progressionEconomy', 'contentModel',
    'difficultyBalance', 'experiencePresentation',
  ],
};

const ruleSchema: JSONSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$', maxLength: 80 },
    kind: { type: 'string', enum: ['principle', 'constraint', 'pattern', 'anti_pattern', 'check'] },
    title: text(120),
    statement: text(800),
    rationale: { type: 'string', maxLength: 1200 },
    appliesWhen: text(500),
    severity: { type: 'string', enum: ['required', 'recommended', 'warning'] },
    evidence: { type: 'string', maxLength: 500 },
  },
  required: ['id', 'kind', 'title', 'statement', 'appliesWhen', 'severity'],
};

const rulesSchema: JSONSchema = {
  type: 'object',
  additionalProperties: false,
  description: 'Complete replacement rule set. kind must be anti_pattern (snake_case), never antiPattern.',
  properties: {
    schemaVersion: { const: 1 },
    genres: { type: 'array', maxItems: 20, items: text(80) },
    philosophies: { type: 'array', maxItems: 20, items: text(120) },
    suitableFor: text(500),
    rules: { type: 'array', minItems: 1, maxItems: 80, items: ruleSchema },
    tableGuidance: {
      type: 'array',
      maxItems: 20,
      description: 'Each entry uses table, purpose, and fields. Do not use name.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          table: text(120),
          purpose: text(500),
          fields: { type: 'array', maxItems: 20, items: text(120) },
        },
        required: ['table', 'purpose', 'fields'],
      },
    },
  },
  required: ['schemaVersion', 'genres', 'philosophies', 'suitableFor', 'rules', 'tableGuidance'],
};

const artStyleSchema: JSONSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    presetId: { type: 'string', minLength: 1, maxLength: 80 },
    presetVersion: { type: 'integer', minimum: 1 },
    customization: {
      type: 'object',
      additionalProperties: false,
      properties: {
        direction: { type: 'string', maxLength: 2000 },
        avoid: { type: 'string', maxLength: 1000 },
        referenceGames: {
          type: 'array',
          maxItems: 8,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: { name: text(120), borrow: text(500) },
            required: ['name', 'borrow'],
          },
        },
      },
      required: ['referenceGames'],
    },
  },
  required: ['presetId', 'presetVersion', 'customization'],
};

export const gameDesignSystemVersionRequestToolSchema: JSONSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    parentVersionId: { type: 'string', format: 'uuid' },
    expectedCurrentVersionId: { type: 'string', format: 'uuid' },
    document: documentSchema,
    rules: rulesSchema,
    artStyle: { anyOf: [artStyleSchema, { type: 'null' }] },
  },
  required: ['parentVersionId', 'expectedCurrentVersionId'],
  anyOf: [
    { required: ['document'] },
    { required: ['rules'] },
    { required: ['artStyle'] },
  ],
};
