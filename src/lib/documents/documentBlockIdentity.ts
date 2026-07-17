import {
  $createHeadingNode,
  $isHeadingNode,
  HeadingNode,
} from '@lexical/rich-text';
import { mergeRegister } from '@lexical/utils';
import type {
  LexicalExportVisitor,
  MdastImportVisitor,
} from '@mdxeditor/editor';
import {
  $createLineBreakNode,
  $createParagraphNode,
  $getRoot,
  $getState,
  $isElementNode,
  $isParagraphNode,
  $isRootNode,
  $setState,
  createState,
  ParagraphNode,
  type LexicalEditor,
} from 'lexical';
import type { Heading, Paragraph, RootContent } from 'mdast';
import type { MdxJsxTextElement } from 'mdast-util-mdx-jsx';
import { isUuid } from '@/lib/utils/uuid';

const BLOCK_ANCHOR_NAME = 'BlockAnchor';
const PARAGRAPH_FLATTENING_PARENT_TYPES = new Set(['listitem', 'admonition']);

export const documentBlockIdState = createState('kecoBlockId', {
  parse: (value) => (typeof value === 'string' && isUuid(value) ? value : ''),
});

export type DocumentReferenceBlock = {
  blockId: string;
  blockType: 'heading' | 'paragraph';
  text: string;
  headingLevel?: number;
  nearestHeading?: string;
};

type DocumentBlockNode = HeadingNode | ParagraphNode;

function isTopLevelDocumentBlock(node: DocumentBlockNode): boolean {
  return $isRootNode(node.getParent());
}

function documentBlocks(): DocumentBlockNode[] {
  return $getRoot()
    .getChildren()
    .filter(
      (node): node is DocumentBlockNode =>
        $isHeadingNode(node) || $isParagraphNode(node)
    );
}

function displayText(node: DocumentBlockNode): string {
  return node.getTextContent().replace(/\s+/g, ' ').trim();
}

export function normalizeDocumentBlockIds(): void {
  const blocks = documentBlocks();
  const seen = new Set<string>();
  for (const [index, node] of blocks.entries()) {
    const current = $getState(node, documentBlockIdState);
    if (isUuid(current) && !seen.has(current)) {
      seen.add(current);
      continue;
    }
    if (
      index === blocks.length - 1 &&
      $isParagraphNode(node) &&
      displayText(node).length === 0
    ) {
      continue;
    }

    let blockId = crypto.randomUUID();
    while (seen.has(blockId)) blockId = crypto.randomUUID();
    $setState(node, documentBlockIdState, blockId);
    seen.add(blockId);
  }
}

const DOCUMENT_BLOCK_SELECTOR =
  '[data-document-block-id], [data-document-block-type]';

function clearDocumentBlockDom(root: HTMLElement | null): void {
  root?.querySelectorAll<HTMLElement>(DOCUMENT_BLOCK_SELECTOR).forEach((element) => {
    delete element.dataset.documentBlockId;
    delete element.dataset.documentBlockType;
  });
}

function reconcileDocumentBlockDom(editor: LexicalEditor): void {
  const currentElements = new Set<HTMLElement>();
  editor.getEditorState().read(() => {
    for (const node of documentBlocks()) {
      const element = editor.getElementByKey(node.getKey());
      if (!element) continue;
      currentElements.add(element);
      const blockId = $getState(node, documentBlockIdState);
      if (!isUuid(blockId)) {
        delete element.dataset.documentBlockId;
        delete element.dataset.documentBlockType;
        continue;
      }
      element.dataset.documentBlockId = blockId;
      element.dataset.documentBlockType = $isHeadingNode(node)
        ? 'heading'
        : 'paragraph';
    }
  });

  editor
    .getRootElement()
    ?.querySelectorAll<HTMLElement>(DOCUMENT_BLOCK_SELECTOR)
    .forEach((element) => {
      if (currentElements.has(element)) return;
      delete element.dataset.documentBlockId;
      delete element.dataset.documentBlockType;
    });
}

export function registerDocumentBlockIdentity(
  editor: LexicalEditor,
  shouldAssignMissingIds: () => boolean
): () => void {
  const normalize = (node: DocumentBlockNode) => {
    if (!shouldAssignMissingIds() || !isTopLevelDocumentBlock(node)) return;
    if (!isUuid($getState(node, documentBlockIdState))) {
      $setState(node, documentBlockIdState, crypto.randomUUID());
    }
    normalizeDocumentBlockIds();
  };
  const unregister = mergeRegister(
    editor.registerUpdateListener(() => reconcileDocumentBlockDom(editor)),
    editor.registerRootListener((nextRoot, previousRoot) => {
      if (previousRoot !== nextRoot) clearDocumentBlockDom(previousRoot);
      reconcileDocumentBlockDom(editor);
    }),
    editor.registerNodeTransform(ParagraphNode, normalize),
    editor.registerNodeTransform(HeadingNode, normalize)
  );

  return () => {
    unregister();
    clearDocumentBlockDom(editor.getRootElement());
  };
}

export function listDocumentReferenceBlocks(): DocumentReferenceBlock[] {
  const blocks: DocumentReferenceBlock[] = [];
  let nearestHeading: string | undefined;

  for (const node of documentBlocks()) {
    const blockId = $getState(node, documentBlockIdState);
    const text = displayText(node);
    if ($isHeadingNode(node)) {
      if (text) nearestHeading = text;
      if (!isUuid(blockId) || !text) continue;
      blocks.push({
        blockId,
        blockType: 'heading',
        text,
        headingLevel: Number(node.getTag().slice(1)),
      });
      continue;
    }
    if (!isUuid(blockId) || !text) continue;
    blocks.push({
      blockId,
      blockType: 'paragraph',
      text,
      ...(nearestHeading ? { nearestHeading } : {}),
    });
  }

  return blocks;
}

function leadingBlockAnchor(
  node: Paragraph | Heading
): { blockId: string; children: RootContent[] } | null {
  const [first, ...children] = node.children;
  if (
    first?.type !== 'mdxJsxTextElement' ||
    first.name !== BLOCK_ANCHOR_NAME ||
    first.children.length !== 0
  ) {
    return null;
  }
  const attributes = first.attributes.filter(
    (attribute) => attribute.type === 'mdxJsxAttribute'
  );
  const idAttribute = attributes.find((attribute) => attribute.name === 'id');
  const blockId = typeof idAttribute?.value === 'string' ? idAttribute.value : '';
  return isUuid(blockId) ? { blockId, children } : null;
}

function blockAnchor(blockId: string): MdxJsxTextElement {
  return {
    type: 'mdxJsxTextElement',
    name: BLOCK_ANCHOR_NAME,
    attributes: [
      {
        type: 'mdxJsxAttribute',
        name: 'id',
        value: blockId,
      },
    ],
    children: [],
  };
}

export const documentParagraphImportVisitor: MdastImportVisitor<Paragraph> = {
  testNode: 'paragraph',
  priority: 100,
  visitNode({ mdastNode, mdastParent, lexicalParent, actions }) {
    const anchor = leadingBlockAnchor(mdastNode);
    if (!anchor) {
      actions.nextVisitor();
      return;
    }

    const content = { ...mdastNode, children: anchor.children };
    const parentType = lexicalParent.getType();
    if (!$isElementNode(lexicalParent)) {
      throw new Error('Document paragraph parent must be an element node');
    }
    if (PARAGRAPH_FLATTENING_PARENT_TYPES.has(parentType)) {
      const nodeIndex = mdastParent?.children.indexOf(mdastNode) ?? -1;
      const previousSibling =
        nodeIndex > 0 ? mdastParent?.children.at(nodeIndex - 1) : undefined;
      if (parentType === 'listitem' && previousSibling?.type === 'paragraph') {
        lexicalParent.append($createLineBreakNode(), $createLineBreakNode());
      }
      actions.visitChildren(content, lexicalParent);
      return;
    }

    const paragraph = $createParagraphNode();
    $setState(paragraph, documentBlockIdState, anchor.blockId);
    lexicalParent.append(paragraph);
    actions.visitChildren(content, paragraph);
  },
};

export const documentHeadingImportVisitor: MdastImportVisitor<Heading> = {
  testNode: 'heading',
  priority: 100,
  visitNode({ mdastNode, lexicalParent, actions }) {
    const anchor = leadingBlockAnchor(mdastNode);
    if (!anchor) {
      actions.nextVisitor();
      return;
    }
    if (!$isElementNode(lexicalParent)) {
      throw new Error('Document heading parent must be an element node');
    }
    const heading = $createHeadingNode(`h${mdastNode.depth}`);
    $setState(heading, documentBlockIdState, anchor.blockId);
    lexicalParent.append(heading);
    actions.visitChildren({ ...mdastNode, children: anchor.children }, heading);
  },
};

export const documentParagraphExportVisitor: LexicalExportVisitor<
  ParagraphNode,
  Paragraph
> = {
  testLexicalNode: $isParagraphNode,
  priority: 100,
  visitLexicalNode({ lexicalNode, mdastParent, actions }) {
    const blockId = $getState(lexicalNode, documentBlockIdState);
    if (
      !isTopLevelDocumentBlock(lexicalNode) ||
      !isUuid(blockId)
    ) {
      actions.nextVisitor();
      return;
    }
    const paragraph: Paragraph = {
      type: 'paragraph',
      children: [blockAnchor(blockId)],
    };
    actions.appendToParent(mdastParent, paragraph);
    actions.registerReferredComponent(BLOCK_ANCHOR_NAME);
    actions.visitChildren(lexicalNode, paragraph);
  },
};

export const documentHeadingExportVisitor: LexicalExportVisitor<
  HeadingNode,
  Heading
> = {
  testLexicalNode: $isHeadingNode,
  priority: 100,
  visitLexicalNode({ lexicalNode, mdastParent, actions }) {
    const blockId = $getState(lexicalNode, documentBlockIdState);
    if (
      !isTopLevelDocumentBlock(lexicalNode) ||
      !isUuid(blockId)
    ) {
      actions.nextVisitor();
      return;
    }
    const heading: Heading = {
      type: 'heading',
      depth: Number(lexicalNode.getTag().slice(1)) as Heading['depth'],
      children: [blockAnchor(blockId)],
    };
    actions.appendToParent(mdastParent, heading);
    actions.registerReferredComponent(BLOCK_ANCHOR_NAME);
    actions.visitChildren(lexicalNode, heading);
  },
};
