import type { SupabaseClient } from '@supabase/supabase-js';
import { parseValidatedSanctionedMdx } from './sanctionedMdx';
import type {
  SanctionedMdxAstAttribute,
  SanctionedMdxAstNode,
} from './sanctionedMdxParser';
import { serializeSanctionedMdxAst } from './sanctionedMdxParser';
import { resolveResourceReferences } from './resourceReferenceService';
import {
  parseResourceReferenceAttributes,
  resourceReferenceKey,
  type ResourceReferenceTarget,
} from './resourceReferenceTypes';

type MutableAstNode = Omit<SanctionedMdxAstNode, 'children'> & {
  children?: MutableAstNode[];
  title?: string | null;
  data?: { exactPlainText?: boolean };
};

function fixedAttributes(
  attributes: readonly SanctionedMdxAstAttribute[] | undefined
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const attribute of attributes ?? []) {
    if (typeof attribute.name === 'string' && typeof attribute.value === 'string') {
      values[attribute.name] = attribute.value;
    }
  }
  return values;
}

function collectReferenceTargets(
  node: SanctionedMdxAstNode,
  targets: ResourceReferenceTarget[]
): void {
  if (
    (node.type === 'mdxJsxTextElement' || node.type === 'mdxJsxFlowElement') &&
    node.name === 'ResourceReference'
  ) {
    const target = parseResourceReferenceAttributes(fixedAttributes(node.attributes));
    if (target) targets.push(target);
  }
  for (const child of node.children ?? []) collectReferenceTargets(child, targets);
}

function transformNode(
  node: SanctionedMdxAstNode,
  resolved: Awaited<ReturnType<typeof resolveResourceReferences>>,
  insideLinkLabel = false
): MutableAstNode[] {
  if (
    (node.type === 'mdxJsxTextElement' || node.type === 'mdxJsxFlowElement') &&
    node.name === 'BlockAnchor'
  ) {
    return [];
  }

  if (
    (node.type === 'mdxJsxTextElement' || node.type === 'mdxJsxFlowElement') &&
    node.name === 'ResourceReference'
  ) {
    const target = parseResourceReferenceAttributes(fixedAttributes(node.attributes));
    const reference = target ? resolved.get(resourceReferenceKey(target)) : undefined;
    if (reference?.status === 'available' && reference.href) {
      if (insideLinkLabel) {
        return [{ type: 'text', value: reference.label }];
      }
      return [{
        type: 'link',
        url: reference.href,
        title: reference.contextLabel ?? null,
        children: [{ type: 'text', value: reference.label }],
      }];
    }
    return insideLinkLabel
      ? [{ type: 'text', value: '[Reference unavailable]' }]
      : [{
          type: 'text',
          value: '[Reference unavailable]',
          data: { exactPlainText: true },
        }];
  }

  const { children, ...rest } = node;
  const childInsideLinkLabel =
    insideLinkLabel || node.type === 'link' || node.type === 'linkReference';
  return [{
    ...rest,
    ...(children
      ? {
          children: children.flatMap((child) =>
            transformNode(child, resolved, childInsideLinkLabel)
          ),
        }
      : {}),
  }];
}

export async function resolveReferencesForPlainMarkdown(
  client: SupabaseClient,
  projectId: string,
  markdown: string
): Promise<string> {
  const root = parseValidatedSanctionedMdx(markdown);
  const targets: ResourceReferenceTarget[] = [];
  collectReferenceTargets(root, targets);
  const resolved = targets.length > 0
    ? await resolveResourceReferences(client, projectId, targets)
    : new Map();
  const transformed = transformNode(root, resolved)[0];

  return serializeSanctionedMdxAst(transformed);
}
