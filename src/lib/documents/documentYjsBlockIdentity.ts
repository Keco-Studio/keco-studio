import * as Y from 'yjs';

const LEXICAL_NODE_STATE_KEY = '__state';
const DOCUMENT_BLOCK_ID_KEY = 'kecoBlockId';

type SharedLexicalNode = Y.XmlText | Y.XmlElement | Y.Map<unknown>;

export type DocumentYjsBlockIdSnapshot = Map<SharedLexicalNode, string>;

function sharedNodeState(node: SharedLexicalNode): unknown {
  return node instanceof Y.Map
    ? node.get(LEXICAL_NODE_STATE_KEY)
    : node.getAttribute(LEXICAL_NODE_STATE_KEY);
}

function setSharedNodeState(
  node: SharedLexicalNode,
  state: Y.Map<unknown>
): void {
  if (node instanceof Y.Map) {
    node.set(LEXICAL_NODE_STATE_KEY, state);
  } else {
    node.setAttribute(LEXICAL_NODE_STATE_KEY, state);
  }
}

function visitSharedLexicalNodes(
  node: SharedLexicalNode,
  visit: (node: SharedLexicalNode) => void
): void {
  visit(node);
  if (node instanceof Y.XmlText) {
    for (const delta of node.toDelta()) {
      if (
        delta.insert instanceof Y.XmlText ||
        delta.insert instanceof Y.XmlElement ||
        delta.insert instanceof Y.Map
      ) {
        visitSharedLexicalNodes(delta.insert, visit);
      }
    }
    return;
  }
  if (node instanceof Y.XmlElement) {
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlText || child instanceof Y.XmlElement) {
        visitSharedLexicalNodes(child, visit);
      }
    }
    return;
  }
  for (const value of node.values()) {
    if (
      value instanceof Y.XmlText ||
      value instanceof Y.XmlElement ||
      value instanceof Y.Map
    ) {
      visitSharedLexicalNodes(value, visit);
    }
  }
}

export function captureDocumentYjsBlockIds(
  doc: Y.Doc
): DocumentYjsBlockIdSnapshot {
  const blockIds: DocumentYjsBlockIdSnapshot = new Map();
  visitSharedLexicalNodes(doc.get('root', Y.XmlText), (node) => {
    const state = sharedNodeState(node);
    if (!(state instanceof Y.Map)) return;
    const blockId = state.get(DOCUMENT_BLOCK_ID_KEY);
    if (typeof blockId === 'string') blockIds.set(node, blockId);
  });
  return blockIds;
}

export function restoreDocumentYjsBlockIds(
  blockIds: DocumentYjsBlockIdSnapshot
): void {
  for (const [node, blockId] of blockIds) {
    const existingState = sharedNodeState(node);
    const state =
      existingState instanceof Y.Map ? existingState : new Y.Map<unknown>();
    if (state !== existingState) {
      setSharedNodeState(node, state);
    }
    state.set(DOCUMENT_BLOCK_ID_KEY, blockId);
  }
}
