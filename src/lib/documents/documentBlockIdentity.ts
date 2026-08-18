import {
  $isListItemNode,
  ListItemNode,
} from '@lexical/list';
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
  $isLineBreakNode,
  $isParagraphNode,
  $isRootNode,
  $isTextNode,
  $setState,
  createState,
  ParagraphNode,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import type { Heading, ListItem, Paragraph, RootContent } from 'mdast';
import type { MdxJsxTextElement } from 'mdast-util-mdx-jsx';
import { isUuid } from '@/lib/utils/uuid';

const BLOCK_ANCHOR_NAME = 'BlockAnchor';
const EMPTY_PARAGRAPH_SENTINEL = ' ';
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

type DocumentBlockNode = HeadingNode | ParagraphNode | ListItemNode;

const TABLE_NODE_TYPES = new Set(['table', 'tablecell', 'tablerow']);

function isTableNode(node: LexicalNode): boolean {
  return TABLE_NODE_TYPES.has(node.getType());
}

function isInsideTable(node: LexicalNode): boolean {
  for (let parent = node.getParent(); parent; parent = parent.getParent()) {
    if (isTableNode(parent)) return true;
  }
  return false;
}

function isTopLevelDocumentBlock(node: DocumentBlockNode): boolean {
  return $isRootNode(node.getParent());
}

function shouldSkipEmptyTrailingParagraph(node: DocumentBlockNode): boolean {
  return (
    $isParagraphNode(node) &&
    isTopLevelDocumentBlock(node) &&
    node.getNextSibling() === null &&
    displayText(node).length === 0
  );
}

function listItemOwnText(node: ListItemNode): string {
  return node
    .getChildren()
    .filter((child) => $isTextNode(child) || $isLineBreakNode(child))
    .map((child) => child.getTextContent())
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function displayText(node: DocumentBlockNode): string {
  if ($isListItemNode(node)) return listItemOwnText(node);
  return node.getTextContent().replace(/\s+/g, ' ').trim();
}

function documentBlocks(): DocumentBlockNode[] {
  const blocks: DocumentBlockNode[] = [];
  const visit = (node: LexicalNode) => {
    if (isTableNode(node)) return;
    if ($isListItemNode(node)) {
      if (listItemOwnText(node)) blocks.push(node);
    } else if ($isHeadingNode(node) || $isParagraphNode(node)) {
      blocks.push(node);
    }
    if ($isElementNode(node)) {
      for (const child of node.getChildren()) visit(child);
    }
  };
  for (const child of $getRoot().getChildren()) visit(child);
  return blocks;
}

export function normalizeDocumentBlockIds(): void {
  const blocks = documentBlocks();
  const seen = new Set<string>();
  for (const node of blocks) {
    const current = $getState(node, documentBlockIdState);
    if (isUuid(current) && !seen.has(current)) {
      seen.add(current);
      continue;
    }
    if (current.length === 0 && shouldSkipEmptyTrailingParagraph(node)) {
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
    if (element.dataset.documentBlockId !== undefined) {
      delete element.dataset.documentBlockId;
    }
    if (element.dataset.documentBlockType !== undefined) {
      delete element.dataset.documentBlockType;
    }
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
        if (element.dataset.documentBlockId !== undefined) {
          delete element.dataset.documentBlockId;
        }
        if (element.dataset.documentBlockType !== undefined) {
          delete element.dataset.documentBlockType;
        }
        continue;
      }
      const blockType = $isHeadingNode(node)
        ? 'heading'
        : 'paragraph';
      if (element.dataset.documentBlockId !== blockId) {
        element.dataset.documentBlockId = blockId;
      }
      if (element.dataset.documentBlockType !== blockType) {
        element.dataset.documentBlockType = blockType;
      }
    }
  });

  editor
    .getRootElement()
    ?.querySelectorAll<HTMLElement>(DOCUMENT_BLOCK_SELECTOR)
    .forEach((element) => {
      if (currentElements.has(element)) return;
      if (element.dataset.documentBlockId !== undefined) {
        delete element.dataset.documentBlockId;
      }
      if (element.dataset.documentBlockType !== undefined) {
        delete element.dataset.documentBlockType;
      }
    });
}

export function registerDocumentBlockIdentity(
  editor: LexicalEditor,
  shouldAssignMissingIds: () => boolean,
  normalizeBlockIds: () => void = normalizeDocumentBlockIds
): () => void {
  let disposed = false;
  let normalizationScheduled = false;
  let normalizing = false;

  const scheduleNormalization = () => {
    if (
      disposed ||
      normalizing ||
      normalizationScheduled ||
      !shouldAssignMissingIds()
    ) {
      return;
    }
    normalizationScheduled = true;
    queueMicrotask(() => {
      normalizationScheduled = false;
      if (disposed || !shouldAssignMissingIds()) return;
      normalizing = true;
      try {
        editor.update(normalizeBlockIds, { discrete: true });
      } finally {
        normalizing = false;
      }
    });
  };

  const normalize = (node: DocumentBlockNode) => {
    if (!shouldAssignMissingIds() || isInsideTable(node)) return;
    if (node.getType() === 'listitem' && !listItemOwnText(node as ListItemNode)) {
      return;
    }
    if (!isUuid($getState(node, documentBlockIdState))) {
      $setState(node, documentBlockIdState, crypto.randomUUID());
    }
    scheduleNormalization();
  };
  const registrations = [
    editor.registerUpdateListener(() => reconcileDocumentBlockDom(editor)),
    editor.registerRootListener((nextRoot, previousRoot) => {
      if (previousRoot !== nextRoot) clearDocumentBlockDom(previousRoot);
      reconcileDocumentBlockDom(editor);
    }),
    editor.registerNodeTransform(ParagraphNode, normalize),
    editor.registerNodeTransform(HeadingNode, normalize),
  ];
  if (editor.hasNode(ListItemNode)) {
    registrations.push(editor.registerNodeTransform(ListItemNode, normalize));
  }
  const unregister = mergeRegister(...registrations);

  return () => {
    disposed = true;
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
  if (!isUuid(blockId)) return null;
  const contentChildren =
    node.type === 'paragraph' &&
    children.length === 1 &&
    children[0]?.type === 'text' &&
    children[0].value === EMPTY_PARAGRAPH_SENTINEL
      ? []
      : children;
  return { blockId, children: contentChildren };
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
      if (parentType === 'listitem') {
        $setState(lexicalParent, documentBlockIdState, anchor.blockId);
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
      !isUuid(blockId) ||
      isInsideTable(lexicalNode) ||
      $isListItemNode(lexicalNode.getParent())
    ) {
      actions.nextVisitor();
      return;
    }
    const paragraph: Paragraph = {
      type: 'paragraph',
      children: [
        blockAnchor(blockId),
        ...(lexicalNode.getChildrenSize() === 0
          ? [{ type: 'text' as const, value: EMPTY_PARAGRAPH_SENTINEL }]
          : []),
      ],
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
    if (!isUuid(blockId) || isInsideTable(lexicalNode)) {
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

export const documentListItemExportVisitor: LexicalExportVisitor<
  ListItemNode,
  ListItem
> = {
  testLexicalNode: $isListItemNode,
  priority: 100,
  visitLexicalNode({ lexicalNode, mdastParent, actions }) {
    const blockId = $getState(lexicalNode, documentBlockIdState);
    const hasNestedElement = lexicalNode
      .getChildren()
      .some((child) => $isElementNode(child));
    if (!isUuid(blockId) || !listItemOwnText(lexicalNode) || hasNestedElement) {
      actions.nextVisitor();
      return;
    }
    const paragraph: Paragraph = {
      type: 'paragraph',
      children: [blockAnchor(blockId)],
    };
    const checked = lexicalNode.getChecked();
    const listItem: ListItem = {
      type: 'listItem',
      ...(checked === undefined ? {} : { checked }),
      children: [paragraph],
    };
    actions.appendToParent(mdastParent, listItem);
    actions.registerReferredComponent(BLOCK_ANCHOR_NAME);
    actions.visitChildren(lexicalNode, paragraph);
  },
};
