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
  coerceSanctionedMdx,
  validateSanctionedMdx,
  validateSanctionedMdxAstNode,
} from './sanctionedMdx';
import type { DocumentReferenceBlock } from './documentBlockIdentity';

export type ValidatedDocumentContent = {
  markdown: string;
};

export type NormalizedDocumentContent = {
  yjsStateBase64: string;
  markdown: string;
  normalizationUpdateBase64: string | null;
  blocks: DocumentReferenceBlock[];
};

export interface DocumentContentCodec {
  validate(markdown: string): ValidatedDocumentContent;
  markdownToYjsState(markdown: string): Promise<string>;
  yjsStateToMarkdown(
    snapshotBase64: string | null,
    updateTailBase64: readonly string[]
  ): Promise<string>;
  normalizeYjsState(
    snapshotBase64: string | null,
    updateTailBase64: readonly string[]
  ): Promise<NormalizedDocumentContent>;
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

function validateMergedYjsUpdate(update: Uint8Array): void {
  const stagingDoc = new Y.Doc();
  try {
    Y.applyUpdate(stagingDoc, update, 'codec-validation');
    validateSerializedMdxNodes(stagingDoc.get('root', Y.XmlText));
  } finally {
    stagingDoc.destroy();
  }
}

function registerLexicalToYjsSync(
  headless: Awaited<ReturnType<typeof createHeadlessDocumentEditor>>,
  binding: Binding,
  provider: Provider,
  onError: (error: unknown) => void
): () => void {
  return headless.editor.registerUpdateListener(
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
        onError(error);
      }
    }
  );
}

async function captureYjsUpdateDuring(
  doc: Y.Doc,
  operation: () => void | Promise<void>
): Promise<Uint8Array | null> {
  const updates: Uint8Array[] = [];
  const onUpdate = (update: Uint8Array) => updates.push(update);
  doc.on('update', onUpdate);
  try {
    await operation();
  } finally {
    doc.off('update', onUpdate);
  }
  return updates.length === 0 ? null : Y.mergeUpdates(updates);
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
  const { markdown: normalized } = documentContentCodec.validate(markdown);
  const headless = await createHeadlessDocumentEditor();
  // The headless Realm exposes no supported public destroy lifecycle.
  headless.clear();
  const doc = new Y.Doc();
  let provider: CodecProvider | null = null;
  let binding: Binding | null = null;
  let unregister: (() => void) | null = null;
  let syncError: unknown = null;

  try {
    provider = createCodecProvider(doc);
    binding = createCodecBinding(headless.editor, provider, doc);
    unregister = registerLexicalToYjsSync(
      headless,
      binding,
      provider,
      (error) => {
        syncError = error;
      }
    );
    if (normalized.trim().length === 0) {
      headless.appendEmptyParagraph();
    } else {
      await headless.setMarkdown(normalized);
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
    unregister?.();
    if (binding) binding.root.destroy(binding);
    provider?.destroy();
    doc.destroy();
  }
}

async function normalizeYjsState(
  snapshotBase64: string | null,
  updateTailBase64: readonly string[]
): Promise<NormalizedDocumentContent> {
  const headless = await createHeadlessDocumentEditor();
  // The headless Realm exposes no supported public destroy lifecycle.
  headless.clear();
  const doc = new Y.Doc();
  let provider: CodecProvider | null = null;
  let binding: Binding | null = null;
  let sharedRoot: ReturnType<Binding['root']['getSharedType']> | null = null;
  let onYjsChange:
    | ((
        events: Array<{ delta: unknown }>,
        transaction: { origin: unknown }
      ) => void)
    | null = null;
  let syncError: unknown = null;
  let unregisterLexicalSync: (() => void) | null = null;

  try {
    provider = createCodecProvider(doc);
    binding = createCodecBinding(headless.editor, provider, doc);
    const activeBinding = binding;
    const activeProvider = provider;
    sharedRoot = binding.root.getSharedType();
    onYjsChange = (
      events: Array<{ delta: unknown }>,
      transaction: { origin: unknown }
    ) => {
      if (transaction.origin === activeBinding) return;
      events.forEach((event) => void event.delta);
      runLexicalYjsSync(() =>
        syncYjsChangesToLexical(
          activeBinding,
          activeProvider,
          events as never,
          false
        )
      );
    };
    sharedRoot.observeDeep(onYjsChange as never);

    const merged = mergeYjsState(snapshotBase64, updateTailBase64);
    const mergedUpdate = decodeBase64(merged);
    validateMergedYjsUpdate(mergedUpdate);
    Y.applyUpdate(doc, mergedUpdate, 'codec-hydration');
    await waitForLexicalCommit();

    unregisterLexicalSync = registerLexicalToYjsSync(
      headless,
      binding,
      provider,
      (error) => {
        syncError = error;
      }
    );
    const normalizationUpdate = await captureYjsUpdateDuring(doc, async () => {
      headless.normalizeBlockIds();
      await waitForLexicalCommit();
      if (syncError) throw syncError;
    });

    const markdown = coerceSanctionedMdx(headless.getMarkdown());
    validateSanctionedMdx(markdown);
    return {
      yjsStateBase64: encodeBase64(Y.encodeStateAsUpdate(doc)),
      markdown,
      normalizationUpdateBase64:
        normalizationUpdate === null ? null : encodeBase64(normalizationUpdate),
      blocks: headless.listReferenceBlocks(),
    };
  } catch (error) {
    throw new DocumentContentValidationError(
      error instanceof Error
        ? `Document content could not be decoded: ${error.message}`
        : 'Document content could not be decoded'
    );
  } finally {
    unregisterLexicalSync?.();
    if (sharedRoot && onYjsChange) {
      sharedRoot.unobserveDeep(onYjsChange as never);
    }
    if (binding) binding.root.destroy(binding);
    provider?.destroy();
    doc.destroy();
  }
}

async function yjsStateToMarkdown(
  snapshotBase64: string | null,
  updateTailBase64: readonly string[]
): Promise<string> {
  return (await normalizeYjsState(snapshotBase64, updateTailBase64)).markdown;
}

export const documentContentCodec: DocumentContentCodec = {
  validate(markdown) {
    const normalized = coerceSanctionedMdx(markdown);
    validateSanctionedMdx(normalized);
    return { markdown: normalized };
  },
  markdownToYjsState,
  yjsStateToMarkdown,
  normalizeYjsState,
  mergeYjsState,
};
