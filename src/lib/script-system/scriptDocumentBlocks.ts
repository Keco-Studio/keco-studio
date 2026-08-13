import { parseValidatedSanctionedMdx } from '@/lib/documents/sanctionedMdx';
import {
  serializeSanctionedMdxAst,
  type SanctionedMdxAstAttribute,
  type SanctionedMdxAstNode,
} from '@/lib/documents/sanctionedMdxParser';
import { isUuid } from '@/lib/utils/uuid';

export type ScriptSourceBlock = {
  blockId: string;
  text: string;
  nodeIndex: number;
};

type MutableNode = Omit<SanctionedMdxAstNode, 'children' | 'attributes'> & {
  children?: MutableNode[];
  attributes?: SanctionedMdxAstAttribute[];
};

function mutableAst(markdown: string): MutableNode {
  return structuredClone(parseValidatedSanctionedMdx(markdown)) as MutableNode;
}

function anchorId(node: MutableNode): string | null {
  if (node.type !== 'paragraph' && node.type !== 'heading') return null;
  const first = node.children?.[0];
  if (first?.type !== 'mdxJsxTextElement' || first.name !== 'BlockAnchor') return null;
  const attribute = first.attributes?.find(
    (candidate) => candidate.type === 'mdxJsxAttribute' && candidate.name === 'id',
  );
  return typeof attribute?.value === 'string' && isUuid(attribute.value)
    ? attribute.value
    : null;
}

function componentFallback(node: MutableNode): string {
  const fallback = node.attributes?.find(
    (attribute) => attribute.type === 'mdxJsxAttribute' && attribute.name === 'fallbackLabel',
  );
  return typeof fallback?.value === 'string' ? fallback.value : '';
}

function visibleText(node: MutableNode): string {
  if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') {
    return node.value ?? '';
  }
  if (node.type === 'image' || node.type === 'imageReference') return node.alt ?? '';
  if (node.type === 'break') return '\n';
  if (node.type === 'mdxJsxTextElement' || node.type === 'mdxJsxFlowElement') {
    if (node.name === 'BlockAnchor') return '';
    if (node.name === 'ResourceReference') return componentFallback(node);
  }
  return (node.children ?? []).map(visibleText).join('');
}

function blockNode(blockId: string, text: string): MutableNode {
  if (!isUuid(blockId)) throw new Error('Script source block ID must be a UUID');
  return {
    type: 'paragraph',
    children: [
      {
        type: 'mdxJsxTextElement',
        name: 'BlockAnchor',
        attributes: [{ type: 'mdxJsxAttribute', name: 'id', value: blockId }],
        children: [],
      },
      { type: 'text', value: text },
    ],
  };
}

function rootChildren(root: MutableNode): MutableNode[] {
  if (root.type !== 'root' || !root.children) {
    throw new Error('Script source document must have a Markdown root');
  }
  return root.children;
}

function findBlockIndex(children: readonly MutableNode[], blockId: string): number {
  const indexes = children.flatMap((node, index) => anchorId(node) === blockId ? [index] : []);
  if (indexes.length !== 1) {
    throw new Error(
      indexes.length === 0
        ? `Script source block not found: ${blockId}`
        : `Script source block ID is duplicated: ${blockId}`,
    );
  }
  return indexes[0];
}

function serialize(root: MutableNode): string {
  return serializeSanctionedMdxAst(root as SanctionedMdxAstNode);
}

export function listScriptSourceBlocks(markdown: string): ScriptSourceBlock[] {
  const root = mutableAst(markdown);
  return rootChildren(root).flatMap((node, nodeIndex) => {
    const blockId = anchorId(node);
    if (!blockId || node.type !== 'paragraph') return [];
    return [{ blockId, text: visibleText(node).trim(), nodeIndex }];
  });
}

export function replaceScriptSourceBlock(
  markdown: string,
  blockId: string,
  text: string,
): string {
  const root = mutableAst(markdown);
  const children = rootChildren(root);
  const index = findBlockIndex(children, blockId);
  if (children[index]?.type !== 'paragraph') {
    throw new Error(`Script source block is not a paragraph: ${blockId}`);
  }
  children[index] = blockNode(blockId, text);
  return serialize(root);
}

export function insertScriptSourceBlock(markdown: string, input: {
  blockId: string;
  text: string;
  anchorBlockId: string;
  edge: 'before' | 'after';
}): string {
  const root = mutableAst(markdown);
  const children = rootChildren(root);
  if (children.some((node) => anchorId(node) === input.blockId)) {
    throw new Error(`Script source block ID is duplicated: ${input.blockId}`);
  }
  const anchorIndex = findBlockIndex(children, input.anchorBlockId);
  children.splice(
    input.edge === 'before' ? anchorIndex : anchorIndex + 1,
    0,
    blockNode(input.blockId, input.text),
  );
  return serialize(root);
}

export function appendScriptSourceBlock(markdown: string, input: {
  blockId: string;
  text: string;
}): string {
  const root = mutableAst(markdown);
  const children = rootChildren(root);
  if (children.some((node) => anchorId(node) === input.blockId)) {
    throw new Error(`Script source block ID is duplicated: ${input.blockId}`);
  }
  children.push(blockNode(input.blockId, input.text));
  return serialize(root);
}

export function deleteScriptSourceBlocks(
  markdown: string,
  blockIds: readonly string[],
): string {
  const root = mutableAst(markdown);
  const children = rootChildren(root);
  const requested = new Set(blockIds);
  if (requested.size !== blockIds.length) {
    throw new Error('Script source block deletion contains duplicate IDs');
  }
  for (const blockId of requested) findBlockIndex(children, blockId);
  root.children = children.filter((node) => {
    const blockId = anchorId(node);
    return !blockId || !requested.has(blockId);
  });
  return serialize(root);
}

export function moveScriptSourceBlocks(markdown: string, input: {
  movingBlockIds: readonly string[];
  target: { blockId: string; edge: 'before' | 'after' };
}): string {
  if (input.movingBlockIds.length === 0) return markdown;
  const root = mutableAst(markdown);
  const children = rootChildren(root);
  const movingIds = new Set(input.movingBlockIds);
  if (movingIds.size !== input.movingBlockIds.length) {
    throw new Error('Script source block move contains duplicate IDs');
  }
  if (movingIds.has(input.target.blockId)) {
    throw new Error('Script source block cannot move relative to itself');
  }
  for (const blockId of movingIds) findBlockIndex(children, blockId);
  findBlockIndex(children, input.target.blockId);

  const movingNodes = input.movingBlockIds.map(
    (blockId) => children[findBlockIndex(children, blockId)],
  );
  const remaining = children.filter((node) => {
    const blockId = anchorId(node);
    return !blockId || !movingIds.has(blockId);
  });
  const targetIndex = findBlockIndex(remaining, input.target.blockId);
  remaining.splice(
    input.target.edge === 'before' ? targetIndex : targetIndex + 1,
    0,
    ...movingNodes,
  );
  root.children = remaining;
  return serialize(root);
}
