import { parseValidatedSanctionedMdx } from '@/lib/documents/sanctionedMdx';
import type { SanctionedMdxAstNode } from '@/lib/documents/sanctionedMdxParser';
import { parseGddMapReferenceAttributes } from '@/lib/documents/gddMapReferenceTypes';
import { parseResourceReferenceAttributes } from '@/lib/documents/resourceReferenceTypes';

export type GddDocumentAssetReference =
  | { sourceType: 'gdd_map_artifact'; sourceId: string; label: string }
  | { sourceType: 'resource_reference'; sourceId: string; label: string }
  | { sourceType: 'markdown_image'; sourceId: string; label: string };

function attributes(node: SanctionedMdxAstNode): Record<string, string> {
  return Object.fromEntries((node.attributes ?? []).flatMap((attribute) => (
    typeof attribute.name === 'string' && typeof attribute.value === 'string'
      ? [[attribute.name, attribute.value]]
      : []
  )));
}

function normalizedUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch {
    return value.trim();
  }
}

export function collectGddDocumentAssetReferences(markdown: string): GddDocumentAssetReference[] {
  const root = parseValidatedSanctionedMdx(markdown);
  const definitions = new Map<string, string>();
  const nodes: SanctionedMdxAstNode[] = [];
  const visit = (node: SanctionedMdxAstNode) => {
    nodes.push(node);
    if (node.type === 'definition' && node.identifier && node.url) definitions.set(node.identifier, node.url);
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);

  const results: GddDocumentAssetReference[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    let reference: GddDocumentAssetReference | null = null;
    if ((node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && node.name === 'GddMapReference') {
      const parsed = parseGddMapReferenceAttributes(attributes(node));
      if (parsed) reference = { sourceType: 'gdd_map_artifact', sourceId: parsed.artifactId, label: parsed.fallbackTitle };
    } else if ((node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && node.name === 'ResourceReference') {
      const parsed = parseResourceReferenceAttributes(attributes(node));
      if (parsed) {
        const sourceId = parsed.kind === 'table-row' ? parsed.assetId : parsed.documentId;
        reference = { sourceType: 'resource_reference', sourceId, label: parsed.fallbackLabel };
      }
    } else if (node.type === 'image' && node.url) {
      reference = { sourceType: 'markdown_image', sourceId: normalizedUrl(node.url), label: node.alt?.trim() ?? '' };
    } else if (node.type === 'imageReference' && node.identifier) {
      const url = definitions.get(node.identifier);
      if (url) reference = { sourceType: 'markdown_image', sourceId: normalizedUrl(url), label: node.alt?.trim() ?? '' };
    }
    if (!reference) continue;
    const key = `${reference.sourceType}:${reference.sourceId}`;
    if (seen.has(key) || results.length >= 200) continue;
    seen.add(key);
    results.push(reference);
  }
  return results;
}
