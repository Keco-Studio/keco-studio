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
  | { mode: 'state'; snapshot: string | null; updates: string[] }
  | { mode: 'normalize-blocks'; markdown: string }
  | { mode: 'capture-delete-only' }
  | {
      mode: 'cleanup';
      target: 'markdown-listener' | 'normalize-observer';
    }
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

type YjsDeleteRange = {
  client: number;
  clock: number;
  length: number;
};

function yjsDeleteRanges(updateBase64: string): YjsDeleteRange[] {
  const { ds } = Y.decodeUpdate(decodeBase64(updateBase64));
  return Array.from(ds.clients.entries()).flatMap(([client, items]) =>
    items.map((item) => ({
      client,
      clock: item.clock,
      length: item.len,
    }))
  );
}

function rangesOverlap(left: YjsDeleteRange, right: YjsDeleteRange): boolean {
  return (
    left.client === right.client &&
    Math.max(left.clock, right.clock) <
      Math.min(left.clock + left.length, right.clock + right.length)
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

async function inspectSetupCleanup(
  target: 'markdown-listener' | 'normalize-observer'
) {
  const sampleHeadless = await createHeadlessDocumentEditor();
  const sampleDoc = new Y.Doc();
  const sampleProvider = createProbeProvider(sampleDoc);
  const sampleBinding = createDocumentLexicalYjsBinding(
    sampleHeadless.editor,
    sampleProvider,
    'cleanup-probe',
    sampleDoc,
    new Map([['cleanup-probe', sampleDoc]])
  );
  const bindingRootPrototype = Object.getPrototypeOf(sampleBinding.root) as {
    destroy(binding: Binding): void;
  };
  const editorPrototype = Object.getPrototypeOf(sampleHeadless.editor) as {
    registerUpdateListener: typeof sampleHeadless.editor.registerUpdateListener;
  };
  sampleBinding.root.destroy(sampleBinding);
  sampleProvider.destroy();
  sampleDoc.destroy();

  const originalDocDestroy = Y.Doc.prototype.destroy;
  const originalAwarenessDestroy = Awareness.prototype.destroy;
  const originalBindingDestroy = bindingRootPrototype.destroy;
  const originalRegisterUpdateListener = editorPrototype.registerUpdateListener;
  const originalObserveDeep = Y.XmlText.prototype.observeDeep;
  const originalUnobserveDeep = Y.XmlText.prototype.unobserveDeep;
  let docDestroyCount = 0;
  let awarenessDestroyCount = 0;
  let bindingDestroyCount = 0;
  let unobserveDeepCount = 0;

  let realmSetupRegistrationCount = 0;
  editorPrototype.registerUpdateListener = function (listener) {
    realmSetupRegistrationCount += 1;
    return originalRegisterUpdateListener.call(this, listener);
  };
  await createHeadlessDocumentEditor();
  editorPrototype.registerUpdateListener = originalRegisterUpdateListener;

  Y.Doc.prototype.destroy = function () {
    docDestroyCount += 1;
    return originalDocDestroy.call(this);
  };
  Awareness.prototype.destroy = function () {
    awarenessDestroyCount += 1;
    return originalAwarenessDestroy.call(this);
  };
  bindingRootPrototype.destroy = function (binding) {
    bindingDestroyCount += 1;
    return originalBindingDestroy.call(this, binding);
  };
  if (target === 'markdown-listener') {
    let registrationCount = 0;
    editorPrototype.registerUpdateListener = function (listener) {
      registrationCount += 1;
      if (registrationCount > realmSetupRegistrationCount) {
        throw new Error('cleanup probe listener setup failure');
      }
      return originalRegisterUpdateListener.call(this, listener);
    };
  } else {
    Y.XmlText.prototype.observeDeep = function (listener) {
      originalObserveDeep.call(this, listener);
      throw new Error('cleanup probe observer setup failure');
    };
    Y.XmlText.prototype.unobserveDeep = function (listener) {
      unobserveDeepCount += 1;
      return originalUnobserveDeep.call(this, listener);
    };
  }

  let errorName = '';
  try {
    if (target === 'markdown-listener') {
      await documentContentCodec.markdownToYjsState('# Cleanup');
    } else {
      await documentContentCodec.normalizeYjsState(null, []);
    }
  } catch (error) {
    errorName = error instanceof Error ? error.name : 'UnknownError';
  } finally {
    Y.Doc.prototype.destroy = originalDocDestroy;
    Awareness.prototype.destroy = originalAwarenessDestroy;
    bindingRootPrototype.destroy = originalBindingDestroy;
    editorPrototype.registerUpdateListener = originalRegisterUpdateListener;
    Y.XmlText.prototype.observeDeep = originalObserveDeep;
    Y.XmlText.prototype.unobserveDeep = originalUnobserveDeep;
  }

  return {
    errorName,
    docDestroyCount,
    awarenessDestroyCount,
    bindingDestroyCount,
    unobserveDeepCount,
  };
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

  if (input.mode === 'state') {
    const markdown = await documentContentCodec.yjsStateToMarkdown(
      input.snapshot,
      input.updates
    );
    return { markdown };
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
    const anchorFreeState = await anchorFreeYjsState(input.markdown);
    const legacyDoc = new Y.Doc();
    Y.applyUpdate(legacyDoc, decodeBase64(anchorFreeState));
    const deletionHistory = legacyDoc.getText('codec-deletion-history');
    deletionHistory.insert(0, 'deleted');
    deletionHistory.delete(0, deletionHistory.length);
    const legacyState = encodeBase64(Y.encodeStateAsUpdate(legacyDoc));
    legacyDoc.destroy();
    const historicalDeleteRanges = yjsDeleteRanges(legacyState);
    const first = await documentContentCodec.normalizeYjsState(legacyState, []);
    const second = await documentContentCodec.normalizeYjsState(
      first.yjsStateBase64,
      []
    );
    const normalizationDeleteRanges =
      first.normalizationUpdateBase64 === null
        ? []
        : yjsDeleteRanges(first.normalizationUpdateBase64);
    return {
      first,
      second,
      historicalDeleteRanges,
      repeatedHistoricalDeleteRanges: normalizationDeleteRanges.filter(
        (normalizationRange) =>
          historicalDeleteRanges.some((historicalRange) =>
            rangesOverlap(normalizationRange, historicalRange)
          )
      ),
      deltaAppliedState:
        first.normalizationUpdateBase64 === null
          ? null
          : mergeYjsState(legacyState, [first.normalizationUpdateBase64]),
    };
  }

  if (input.mode === 'capture-delete-only') {
    const doc = new Y.Doc();
    const text = doc.getText('delete-only');
    text.insert(0, 'deleted');
    const beforeDelete = encodeBase64(Y.encodeStateAsUpdate(doc));
    const captured = await captureYjsUpdateDuring(doc, () => {
      text.delete(0, text.length);
    });
    const capturedBase64 = captured === null ? null : encodeBase64(captured);
    const replica = new Y.Doc();
    Y.applyUpdate(replica, decodeBase64(beforeDelete));
    if (captured) Y.applyUpdate(replica, captured);
    const result = {
      capturedBase64,
      structCount: captured === null ? null : Y.decodeUpdate(captured).structs.length,
      deleteRanges:
        capturedBase64 === null ? [] : yjsDeleteRanges(capturedBase64),
      replicaText: replica.getText('delete-only').toString(),
      stateVectorsEqual:
        encodeBase64(Y.encodeStateVector(replica)) ===
        encodeBase64(Y.encodeStateVector(doc)),
    };
    replica.destroy();
    doc.destroy();
    return result;
  }

  if (input.mode === 'cleanup') {
    return inspectSetupCleanup(input.target);
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
