import {
  syncLexicalUpdateToYjs,
  syncYjsChangesToLexical,
  type Binding,
  type Provider,
} from '@lexical/yjs';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import {
  decodeBase64,
  encodeBase64,
} from './documentCollaborationProtocol';
import { DocumentContentValidationError } from './documentStateTypes';
import { createDocumentLexicalYjsBinding } from './documentLexicalYjsBinding';
import {
  createHeadlessDocumentEditor,
  waitForLexicalCommit,
} from './headlessDocumentNodes';
import {
  validateSanctionedMdx,
  validateSanctionedMdxAstNode,
} from './sanctionedMdx';

export type ValidatedDocumentContent = {
  markdown: string;
};

export interface DocumentContentCodec {
  validate(markdown: string): ValidatedDocumentContent;
  markdownToYjsState(markdown: string): Promise<string>;
  yjsStateToMarkdown(
    snapshotBase64: string | null,
    updateTailBase64: readonly string[]
  ): Promise<string>;
  mergeYjsState(
    snapshotBase64: string | null,
    updateTailBase64: readonly string[]
  ): string;
}

type CodecProvider = Provider & { destroy(): void };

const YJS_PREMATURE_ACCESS_WARNING =
  'Invalid access: Add Yjs type to a document before reading data.';

function runLexicalYjsSync<T>(operation: () => T): T {
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (args.length === 1 && args[0] === YJS_PREMATURE_ACCESS_WARNING) return;
    originalWarn(...args);
  };
  try {
    return operation();
  } finally {
    console.warn = originalWarn;
  }
}

function createCodecProvider(doc: Y.Doc): CodecProvider {
  const awareness = new Awareness(doc);
  return {
    awareness: awareness as unknown as Provider['awareness'],
    connect: () => undefined,
    disconnect: () => undefined,
    on: () => undefined,
    off: () => undefined,
    destroy: () => awareness.destroy(),
  };
}

function createCodecBinding(
  editor: Awaited<ReturnType<typeof createHeadlessDocumentEditor>>['editor'],
  provider: Provider,
  doc: Y.Doc
): Binding {
  return createDocumentLexicalYjsBinding(
    editor,
    provider,
    'document',
    doc,
    new Map([['document', doc]])
  );
}

function validateSerializedMdxNodes(value: unknown): void {
  if (value instanceof Y.XmlElement) {
    if (value.getAttribute('__type') === 'jsx') {
      validateSanctionedMdxAstNode(value.getAttribute('__mdastNode'));
    }
    for (const child of value.toArray()) validateSerializedMdxNodes(child);
    return;
  }
  if (value instanceof Y.XmlText) {
    for (const delta of value.toDelta()) {
      if (typeof delta.insert !== 'string') {
        validateSerializedMdxNodes(delta.insert);
      }
    }
  }
}

export function mergeYjsState(
  snapshotBase64: string | null,
  updateTailBase64: readonly string[]
): string {
  try {
    const updates: Uint8Array[] = [];
    if (snapshotBase64) updates.push(decodeBase64(snapshotBase64));
    for (const encoded of new Set(updateTailBase64)) {
      updates.push(decodeBase64(encoded));
    }
    if (updates.length === 0) {
      const empty = new Y.Doc();
      const state = Y.encodeStateAsUpdate(empty);
      empty.destroy();
      return encodeBase64(state);
    }
    return encodeBase64(Y.mergeUpdates(updates));
  } catch (error) {
    throw new DocumentContentValidationError(
      error instanceof Error
        ? `Document Yjs state is invalid: ${error.message}`
        : 'Document Yjs state is invalid'
    );
  }
}

async function markdownToYjsState(markdown: string): Promise<string> {
  documentContentCodec.validate(markdown);
  const headless = await createHeadlessDocumentEditor();
  headless.clear();
  const doc = new Y.Doc();
  const provider = createCodecProvider(doc);
  const binding = createCodecBinding(headless.editor, provider, doc);
  let syncError: unknown = null;

  const unregister = headless.editor.registerUpdateListener(
    ({
      prevEditorState,
      editorState,
      dirtyElements,
      dirtyLeaves,
      normalizedNodes,
      tags,
    }) => {
      try {
        runLexicalYjsSync(() =>
          syncLexicalUpdateToYjs(
            binding,
            provider,
            prevEditorState,
            editorState,
            dirtyElements,
            dirtyLeaves,
            normalizedNodes,
            tags
          )
        );
      } catch (error) {
        syncError = error;
      }
    }
  );

  try {
    if (markdown.trim().length === 0) {
      headless.appendEmptyParagraph();
    } else {
      await headless.setMarkdown(markdown);
    }
    headless.normalizeBlockIds();
    if (syncError) throw syncError;
    return encodeBase64(Y.encodeStateAsUpdate(doc));
  } catch (error) {
    throw new DocumentContentValidationError(
      error instanceof Error
        ? `Document content could not be encoded: ${error.message}`
        : 'Document content could not be encoded'
    );
  } finally {
    unregister();
    provider.destroy();
    doc.destroy();
  }
}

async function yjsStateToMarkdown(
  snapshotBase64: string | null,
  updateTailBase64: readonly string[]
): Promise<string> {
  const headless = await createHeadlessDocumentEditor();
  headless.clear();
  const doc = new Y.Doc();
  const provider = createCodecProvider(doc);
  const binding = createCodecBinding(headless.editor, provider, doc);
  const sharedRoot = binding.root.getSharedType();

  const onYjsChange = (
    events: Array<{ delta: unknown }>,
    transaction: { origin: unknown }
  ) => {
    if (transaction.origin === binding) return;
    events.forEach((event) => void event.delta);
    runLexicalYjsSync(() =>
      syncYjsChangesToLexical(binding, provider, events as never, false)
    );
  };

  sharedRoot.observeDeep(onYjsChange as never);
  try {
    const merged = mergeYjsState(snapshotBase64, updateTailBase64);
    const mergedUpdate = decodeBase64(merged);
    const stagingDoc = new Y.Doc();
    try {
      Y.applyUpdate(stagingDoc, mergedUpdate, 'codec-validation');
      validateSerializedMdxNodes(stagingDoc.get('root', Y.XmlText));
    } finally {
      stagingDoc.destroy();
    }
    Y.applyUpdate(doc, mergedUpdate, 'codec-hydration');
    await waitForLexicalCommit();
    const markdown = headless.getMarkdown();
    validateSanctionedMdx(markdown);
    return markdown;
  } catch (error) {
    throw new DocumentContentValidationError(
      error instanceof Error
        ? `Document content could not be decoded: ${error.message}`
        : 'Document content could not be decoded'
    );
  } finally {
    sharedRoot.unobserveDeep(onYjsChange as never);
    provider.destroy();
    doc.destroy();
  }
}

export const documentContentCodec: DocumentContentCodec = {
  validate(markdown) {
    validateSanctionedMdx(markdown);
    return { markdown };
  },
  markdownToYjsState,
  yjsStateToMarkdown,
  mergeYjsState,
};
