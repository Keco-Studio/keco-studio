import { once } from 'node:events';
import {
  syncLexicalUpdateToYjs,
  syncYjsChangesToLexical,
  type Binding,
  type Provider,
} from '@lexical/yjs';
import { $getRoot } from 'lexical';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import {
  documentContentCodec,
  mergeYjsState,
} from '../../src/lib/documents/documentContentCodec';
import { createDocumentLexicalYjsBinding } from '../../src/lib/documents/documentLexicalYjsBinding';
import { createHeadlessDocumentEditor } from '../../src/lib/documents/headlessDocumentNodes';
import {
  decodeBase64,
  encodeBase64,
} from '../../src/lib/documents/documentCollaborationProtocol';

type ProbeInput =
  | { mode: 'roundtrip'; markdown: string }
  | { mode: 'structure'; markdown: string }
  | { mode: 'decorators'; markdown: string }
  | { mode: 'lexical'; markdown: string }
  | { mode: 'merge'; markdown: string }
  | { mode: 'normalize-blocks'; markdown: string }
  | { mode: 'crafted-invalid-jsx'; component: 'Callout' | 'Unknown' }
  | { mode: 'invalid'; markdown: string; state: string };

async function readInput(): Promise<ProbeInput> {
  const chunks: Buffer[] = [];
  process.stdin.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  await once(process.stdin, 'end');
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as ProbeInput;
}

const decoratorEmitterProperties = new Map([
  ['table', 'focusEmitter'],
  ['codeblock', '__focusEmitter'],
  ['jsx', '__focusEmitter'],
]);

function visitYjsDecoratorNodes(
  root: Y.XmlText,
  visitor: (node: Y.XmlElement, type: string) => void
): void {
  const visit = (value: unknown): void => {
    if (value instanceof Y.XmlElement) {
      const type = value.getAttribute('__type');
      if (typeof type === 'string' && decoratorEmitterProperties.has(type)) {
        visitor(value, type);
      }
      for (const child of value.toArray()) visit(child);
      return;
    }
    if (value instanceof Y.XmlText) {
      for (const delta of value.toDelta()) {
        if (typeof delta.insert !== 'string') visit(delta.insert);
      }
    }
  };

  visit(root);
}

function createProbeProvider(doc: Y.Doc): Provider & { destroy(): void } {
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

async function anchorFreeYjsState(markdown: string): Promise<string> {
  const headless = await createHeadlessDocumentEditor();
  headless.clear();
  const doc = new Y.Doc();
  const provider = createProbeProvider(doc);
  const binding = createDocumentLexicalYjsBinding(
    headless.editor,
    provider,
    'document',
    doc,
    new Map([['document', doc]])
  );
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
        const originalWarn = console.warn;
        console.warn = (...args: unknown[]) => {
          if (
            args.length === 1 &&
            args[0] ===
              'Invalid access: Add Yjs type to a document before reading data.'
          ) {
            return;
          }
          originalWarn(...args);
        };
        try {
          syncLexicalUpdateToYjs(
            binding as Binding,
            provider,
            prevEditorState,
            editorState,
            dirtyElements,
            dirtyLeaves,
            normalizedNodes,
            tags
          );
        } finally {
          console.warn = originalWarn;
        }
      } catch (error) {
        syncError = error;
      }
    }
  );

  try {
    await headless.setMarkdown(markdown);
    if (syncError) throw syncError;
    return encodeBase64(Y.encodeStateAsUpdate(doc));
  } finally {
    unregister();
    binding.root.destroy(binding);
    provider.destroy();
    doc.destroy();
  }
}

function craftedInvalidJsxState(component: 'Callout' | 'Unknown'): string {
  const doc = new Y.Doc();
  const jsx = new Y.XmlElement();
  jsx.setAttribute('__type', 'jsx');
  jsx.setAttribute('__mdastNode', {
    type: 'mdxJsxFlowElement',
    name: component,
    attributes:
      component === 'Callout'
        ? [{ type: 'mdxJsxAttribute', name: 'type', value: 'danger' }]
        : [],
    children: [
      { type: 'paragraph', children: [{ type: 'text', value: 'Body.' }] },
    ],
  });
  doc.get('root', Y.XmlText).insertEmbed(0, jsx);
  const encoded = encodeBase64(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return encoded;
}

async function inspectDecoratorBinding(markdown: string) {
  const snapshot = await documentContentCodec.markdownToYjsState(markdown);
  const snapshotDoc = new Y.Doc();
  Y.applyUpdate(snapshotDoc, decodeBase64(snapshot));
  const snapshotRoot = snapshotDoc.get('root', Y.XmlText);
  const decoratorAttributes: Array<{
    type: string;
    attributes: string[];
  }> = [];

  visitYjsDecoratorNodes(snapshotRoot, (node, type) => {
    decoratorAttributes.push({
      type,
      attributes: Object.keys(node.getAttributes()).sort(),
    });
    const emitterProperty = decoratorEmitterProperties.get(type)!;
    node.setAttribute(emitterProperty, {});
  });

  const legacySnapshot = Y.encodeStateAsUpdate(snapshotDoc);
  const headless = await createHeadlessDocumentEditor();
  headless.editor.update(() => $getRoot().clear(), { discrete: true });
  const hydratedDoc = new Y.Doc();
  const provider = createProbeProvider(hydratedDoc);
  const binding = createDocumentLexicalYjsBinding(
    headless.editor,
    provider,
    'decorator-probe',
    hydratedDoc,
    new Map([['decorator-probe', hydratedDoc]])
  );
  const sharedRoot = binding.root.getSharedType();
  const onYjsChange = (
    events: Array<{ delta: unknown }>,
    transaction: { origin: unknown }
  ) => {
    if (transaction.origin === binding) return;
    events.forEach((event) => void event.delta);
    syncYjsChangesToLexical(binding, provider, events as never, false);
  };

  sharedRoot.observeDeep(onYjsChange as never);
  try {
    Y.applyUpdate(hydratedDoc, legacySnapshot, 'decorator-probe-hydration');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const runtimeEmitters = headless.editor.getEditorState().read(() =>
      $getRoot()
        .getChildren()
        .filter((node) => decoratorEmitterProperties.has(node.getType()))
        .map((node) => {
          const type = node.getType();
          const emitterProperty = decoratorEmitterProperties.get(type)!;
          const emitter = (node as unknown as Record<string, unknown>)[
            emitterProperty
          ] as { publish?: unknown; subscribe?: unknown } | undefined;
          return {
            type,
            publish: typeof emitter?.publish,
            subscribe: typeof emitter?.subscribe,
          };
        })
    );
    return { decoratorAttributes, runtimeEmitters };
  } finally {
    sharedRoot.unobserveDeep(onYjsChange as never);
    binding.root.destroy(binding);
    provider.destroy();
    hydratedDoc.destroy();
    snapshotDoc.destroy();
  }
}

async function main() {
  const input = await readInput();
  if (input.mode === 'roundtrip') {
    const snapshot = await documentContentCodec.markdownToYjsState(input.markdown);
    const markdown = await documentContentCodec.yjsStateToMarkdown(snapshot, []);
    return { markdown };
  }

  if (input.mode === 'structure') {
    const snapshot = await documentContentCodec.markdownToYjsState(input.markdown);
    const doc = new Y.Doc();
    const root = doc.get('root', Y.XmlText);
    Y.applyUpdate(doc, decodeBase64(snapshot));
    const result = {
      rootType: root?.constructor.name,
      rootLength: root instanceof Y.XmlText ? root.length : 0,
      hasMarkdownText: doc.share.has('md'),
    };
    doc.destroy();
    return result;
  }

  if (input.mode === 'decorators') {
    return inspectDecoratorBinding(input.markdown);
  }

  if (input.mode === 'lexical') {
    const headless = await createHeadlessDocumentEditor();
    await headless.setMarkdown(input.markdown);
    return {
      markdown: headless.getMarkdown(),
      nodes: headless.editor.getEditorState().toJSON().root.children,
    };
  }

  if (input.mode === 'merge') {
    const snapshot = await documentContentCodec.markdownToYjsState(input.markdown);
    const source = new Y.Doc();
    Y.applyUpdate(source, decodeBase64(snapshot));
    const vector = Y.encodeStateVector(source);
    const clientA = new Y.Doc();
    const clientB = new Y.Doc();
    Y.applyUpdate(clientA, decodeBase64(snapshot));
    Y.applyUpdate(clientB, decodeBase64(snapshot));
    clientA.getMap('codec-test').set('a', 1);
    clientB.getMap('codec-test').set('b', 2);
    const updateA = encodeBase64(Y.encodeStateAsUpdate(clientA, vector));
    const updateB = encodeBase64(Y.encodeStateAsUpdate(clientB, vector));
    const first = mergeYjsState(snapshot, [updateA, updateB, updateA]);
    const second = mergeYjsState(snapshot, [updateB, updateA]);
    const markdown = await documentContentCodec.yjsStateToMarkdown(first, []);
    const result = {
      equal: first === second,
      markdown,
    };
    source.destroy();
    clientA.destroy();
    clientB.destroy();
    return result;
  }

  if (input.mode === 'normalize-blocks') {
    const legacyState = await anchorFreeYjsState(input.markdown);
    const first = await documentContentCodec.normalizeYjsState(legacyState, []);
    const second = await documentContentCodec.normalizeYjsState(
      first.yjsStateBase64,
      []
    );
    const editedDoc = new Y.Doc();
    Y.applyUpdate(editedDoc, decodeBase64(first.yjsStateBase64));
    const deletionHistory = editedDoc.getText('codec-deletion-history');
    deletionHistory.insert(0, 'deleted');
    deletionHistory.delete(0, deletionHistory.length);
    const canonicalStateWithDeletionHistory = encodeBase64(
      Y.encodeStateAsUpdate(editedDoc)
    );
    editedDoc.destroy();
    const afterDeletionHistory = await documentContentCodec.normalizeYjsState(
      canonicalStateWithDeletionHistory,
      []
    );
    return {
      first,
      second,
      afterDeletionHistory,
      deltaAppliedState:
        first.normalizationUpdateBase64 === null
          ? null
          : mergeYjsState(legacyState, [first.normalizationUpdateBase64]),
    };
  }

  if (input.mode === 'crafted-invalid-jsx') {
    let errorName = '';
    try {
      await documentContentCodec.yjsStateToMarkdown(
        craftedInvalidJsxState(input.component),
        []
      );
    } catch (error) {
      errorName = error instanceof Error ? error.name : 'UnknownError';
    }
    return { errorName };
  }

  let validateError = '';
  let stateError = '';
  try {
    documentContentCodec.validate(input.markdown);
  } catch (error) {
    validateError = error instanceof Error ? error.name : 'UnknownError';
  }
  try {
    await documentContentCodec.yjsStateToMarkdown(input.state, []);
  } catch (error) {
    stateError = error instanceof Error ? error.name : 'UnknownError';
  }
  return { validateError, stateError };
}

void main()
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  })
  .catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
