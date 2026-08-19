import {
  parseSanctionedMdxAst,
  serializeSanctionedMdxAst,
  type SanctionedMdxAstNode,
} from './sanctionedMdxParser';
import { parseValidatedSanctionedMdx } from './sanctionedMdx';
import {
  gddMapReferenceAttributes,
  sanitizeGddMapFallbackTitle,
  type GddMapReferenceAttributes,
} from './gddMapReferenceTypes';
import { isUuid } from '@/lib/utils/uuid';

export type GddMapReferenceArtifact = {
  artifactId: string;
  sourceHeading: string;
  fallbackTitle: string;
};

function textContent(node: SanctionedMdxAstNode): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? '';
  return (node.children ?? []).map(textContent).join('');
}

function headingTitle(node: SanctionedMdxAstNode): string {
  return textContent(node).trim();
}

function mapReferenceNode(attributes: GddMapReferenceAttributes): SanctionedMdxAstNode {
  return {
    type: 'mdxJsxFlowElement',
    name: 'GddMapReference',
    attributes: Object.entries(gddMapReferenceAttributes(attributes)).map(([name, value]) => ({
      type: 'mdxJsxAttribute', name, value,
    })),
    children: [],
  };
}

function headingNode(title: string, depth = 2): SanctionedMdxAstNode {
  return { type: 'heading', depth, children: [{ type: 'text', value: title }] };
}

function normalizeArtifact(value: GddMapReferenceArtifact): GddMapReferenceArtifact | null {
  if (!isUuid(value.artifactId)) return null;
  const sourceHeading = value.sourceHeading.trim();
  const fallbackTitle = sanitizeGddMapFallbackTitle(value.fallbackTitle);
  if (!sourceHeading || !fallbackTitle) return null;
  return { artifactId: value.artifactId, sourceHeading, fallbackTitle };
}

/**
 * Add controlled map references to a validated GDD. IDs and titles are the
 * only durable values written to Markdown; URLs and provider data stay out.
 */
export function decorateGddWithMapReferences(
  markdown: string,
  artifacts: readonly GddMapReferenceArtifact[],
): string {
  if (artifacts.length === 0) return markdown;
  const normalized = artifacts.map(normalizeArtifact).filter((value): value is GddMapReferenceArtifact => Boolean(value));
  if (normalized.length === 0) return markdown;
  parseValidatedSanctionedMdx(markdown);
  const root = parseSanctionedMdxAst(markdown);
  const unique = [...new Map(normalized.map((artifact) => [artifact.artifactId, artifact])).values()];
  const inserted = new Set<string>();
  const children: SanctionedMdxAstNode[] = [];
  for (const child of root.children ?? []) {
    children.push(child);
    if (child.type !== 'heading') continue;
    const title = headingTitle(child);
    for (const artifact of unique) {
      if (inserted.has(artifact.artifactId) || artifact.sourceHeading !== title) continue;
      children.push(mapReferenceNode({ artifactId: artifact.artifactId, display: 'compact', fallbackTitle: artifact.fallbackTitle }));
      inserted.add(artifact.artifactId);
    }
  }
  const fullArtifacts = unique.filter((artifact) => inserted.has(artifact.artifactId));
  if (fullArtifacts.length === 0) return markdown;
  children.push(headingNode('Maps and Levels'));
  for (const artifact of fullArtifacts) {
    children.push(mapReferenceNode({ artifactId: artifact.artifactId, display: 'full', fallbackTitle: artifact.fallbackTitle }));
  }
  return serializeSanctionedMdxAst({ ...root, children });
}

