import { once } from 'node:events';
import * as Y from 'yjs';
import {
  documentContentCodec,
  mergeYjsState,
} from '../../src/lib/documents/documentContentCodec';
import { createHeadlessDocumentEditor } from '../../src/lib/documents/headlessDocumentNodes';
import {
  decodeBase64,
  encodeBase64,
} from '../../src/lib/documents/documentCollaborationProtocol';

type ProbeInput =
  | { mode: 'roundtrip'; markdown: string }
  | { mode: 'structure'; markdown: string }
  | { mode: 'lexical'; markdown: string }
  | { mode: 'merge'; markdown: string }
  | { mode: 'invalid'; markdown: string; state: string };

async function readInput(): Promise<ProbeInput> {
  const chunks: Buffer[] = [];
  process.stdin.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  await once(process.stdin, 'end');
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as ProbeInput;
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
