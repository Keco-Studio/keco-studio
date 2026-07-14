import {
  createBinding,
  syncLexicalUpdateToYjs,
  syncYjsChangesToLexical,
  type Binding,
  type Provider,
} from '@lexical/yjs';
import { $createParagraphNode, $getRoot } from 'lexical';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import {
  decodeBase64,
  encodeBase64,
} from './documentCollaborationProtocol';
import { DocumentContentValidationError } from './documentStateTypes';
import {
  createHeadlessDocumentEditor,
  waitForLexicalCommit,
} from './headlessDocumentNodes';

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
  return createBinding(
    editor,
    provider,
    'document',
    doc,
    new Map([['document', doc]])
  );
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
  headless.editor.update(() => $getRoot().clear(), { discrete: true });
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
      headless.editor.update(
        () => $getRoot().append($createParagraphNode()),
        { discrete: true }
      );
    } else {
      await headless.setMarkdown(markdown);
    }
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
  headless.editor.update(() => $getRoot().clear(), { discrete: true });
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
    Y.applyUpdate(doc, decodeBase64(merged), 'codec-hydration');
    await waitForLexicalCommit();
    return headless.getMarkdown();
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
    if (typeof markdown !== 'string' || markdown.includes('\u0000')) {
      throw new DocumentContentValidationError();
    }
    return { markdown };
  },
  markdownToYjsState,
  yjsStateToMarkdown,
  mergeYjsState,
};
