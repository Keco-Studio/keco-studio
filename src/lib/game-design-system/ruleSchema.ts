import { z } from 'zod';

export const gameDesignSystemTitleSchema = z.string()
  .trim()
  .min(1)
  .max(120)
  .refine((value) => !/[\r\n\u2028\u2029]/u.test(value), 'Title must be a single line.');
import { parseSanctionedMdxAst, type SanctionedMdxAstNode } from '@/lib/documents/sanctionedMdxParser';

export const RULE_SET_MAX_BYTES = 64 * 1024;

const boundedString = (max: number) => z.string().trim().min(1).max(max);

export const gameDesignRuleSchema = z.object({
  id: z.string().trim().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).max(80),
  kind: z.enum(['principle', 'constraint', 'pattern', 'anti_pattern', 'check']),
  title: boundedString(120),
  statement: boundedString(800),
  rationale: z.string().trim().max(1200).optional(),
  appliesWhen: boundedString(500),
  severity: z.enum(['required', 'recommended', 'warning']),
  evidence: z.string().trim().max(500).optional(),
}).strict();

export const tableGuidanceSchema = z.object({
  table: boundedString(120),
  purpose: boundedString(500),
  fields: z.array(boundedString(120)).max(20),
}).strict();

export const gameDesignRuleSetSchema = z.object({
  schemaVersion: z.literal(1),
  genres: z.array(boundedString(80)).max(20),
  philosophies: z.array(boundedString(120)).max(20),
  suitableFor: boundedString(500),
  rules: z.array(gameDesignRuleSchema).min(1).max(80),
  tableGuidance: z.array(tableGuidanceSchema).max(20),
}).strict().superRefine((value, ctx) => {
  const ids = new Set<string>();
  value.rules.forEach((rule, index) => {
    if (ids.has(rule.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rules', index, 'id'],
        message: `Duplicate rule ID: ${rule.id}`,
      });
    }
    ids.add(rule.id);
  });
});

export type GameDesignRule = z.infer<typeof gameDesignRuleSchema>;
export type GameDesignRuleSet = z.infer<typeof gameDesignRuleSetSchema>;
export type TableGuidance = z.infer<typeof tableGuidanceSchema>;

export function parseRuleSet(value: unknown): GameDesignRuleSet {
  const parsed = gameDesignRuleSetSchema.parse(value);
  const bytes = new TextEncoder().encode(JSON.stringify(parsed)).byteLength;
  if (bytes > RULE_SET_MAX_BYTES) {
    throw new Error(`Game Design Rule Set exceeds the 64 KiB limit (${bytes} bytes).`);
  }
  return parsed;
}

function plainText(node: SanctionedMdxAstNode): string {
  if (typeof node.value === 'string') return node.value;
  return (node.children ?? []).map(plainText).join('').trim();
}

function slug(value: string, fallback: string): string {
  const normalized = value.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized && /^[a-z]/.test(normalized) ? normalized : fallback;
}

function legacySectionItems(body: string, sectionName: string): string[] {
  const root = parseSanctionedMdxAst(body);
  const children = root.children ?? [];
  let inSection = false;
  const items: string[] = [];
  for (const child of children) {
    if (child.type === 'heading' && child.depth === 2) {
      inSection = plainText(child).toLowerCase().includes(sectionName.toLowerCase());
      continue;
    }
    if (!inSection) continue;
    if (child.type === 'list') {
      for (const listItem of child.children ?? []) {
        const text = plainText(listItem).replace(/\s+/g, ' ').trim();
        if (text) items.push(text.slice(0, 800));
      }
    } else if (child.type === 'paragraph') {
      const text = plainText(child).replace(/\s+/g, ' ').trim();
      if (text) items.push(text.slice(0, 800));
    }
  }
  return items;
}

export function buildLegacyRuleSet(input: {
  genres?: string[];
  philosophies?: string[];
  suitableFor?: string | null;
  body: string;
}): GameDesignRuleSet {
  const principles = legacySectionItems(input.body, 'Design Principles');
  const antiPatterns = legacySectionItems(input.body, 'Anti-patterns');
  const seen = new Set<string>();
  const rules: GameDesignRule[] = [];
  const add = (statement: string, kind: 'principle' | 'anti_pattern', index: number) => {
    let id = slug(statement, `legacy-${kind.replace('_', '-')}-${index + 1}`);
    while (seen.has(id)) id = `${id}-${index + 1}`;
    seen.add(id);
    rules.push({
      id,
      kind,
      title: statement.slice(0, 120),
      statement,
      appliesWhen: 'Reviewing game design work governed by this legacy system.',
      severity: kind === 'principle' ? 'recommended' : 'warning',
    });
  };
  principles.forEach((statement, index) => add(statement, 'principle', index));
  antiPatterns.forEach((statement, index) => add(statement, 'anti_pattern', index));
  if (rules.length === 0) {
    rules.push({
      id: 'legacy-review-required',
      kind: 'check',
      title: 'Review legacy system content',
      statement: 'Review the original Markdown before relying on this migrated system.',
      appliesWhen: 'Using a system migrated from unstructured Markdown.',
      severity: 'warning',
    });
  }
  return parseRuleSet({
    schemaVersion: 1,
    genres: (input.genres ?? []).slice(0, 20),
    philosophies: (input.philosophies ?? []).slice(0, 20),
    suitableFor: input.suitableFor?.trim() || 'Legacy projects requiring manual review',
    rules,
    tableGuidance: [],
  });
}
