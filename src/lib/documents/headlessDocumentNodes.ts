import { Realm } from '@mdxeditor/gurx';
import * as mdxEditorRuntime from '@mdxeditor/editor';
import type { JsxComponentDescriptor, RealmPlugin } from '@mdxeditor/editor';
import type { LexicalEditor } from 'lexical';

const {
  codeBlockPlugin,
  codeMirrorPlugin,
  headingsPlugin,
  imagePlugin,
  linkPlugin,
  listsPlugin,
  markdown$,
  markdownProcessingError$,
  quotePlugin,
  rootEditor$,
  setMarkdown$,
  tablePlugin,
  thematicBreakPlugin,
  jsxPlugin,
  GenericJsxEditor,
} = mdxEditorRuntime;
import {
  createSanctionedMdxDescriptors,
  type SanctionedMdxEditorProps,
} from './sanctionedMdxDescriptors';
import type { ComponentType } from 'react';

const corePlugin = (
  mdxEditorRuntime as unknown as {
    corePlugin: (params: {
      initialMarkdown: string;
      onChange: () => void;
      suppressSharedHistory: boolean;
    }) => RealmPlugin;
  }
).corePlugin;

export type HeadlessDocumentEditor = {
  editor: LexicalEditor;
  clear(): void;
  appendEmptyParagraph(): void;
  getMarkdown(): string;
  setMarkdown(markdown: string): Promise<void>;
};

function documentPlugins(): RealmPlugin[] {
  const sanctionedMdxDescriptors = createSanctionedMdxDescriptors(
    GenericJsxEditor as unknown as ComponentType<SanctionedMdxEditorProps>
  );
  return [
    corePlugin({
      initialMarkdown: '',
      onChange: () => undefined,
      suppressSharedHistory: true,
    }),
    headingsPlugin(),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    jsxPlugin({
      jsxComponentDescriptors:
        sanctionedMdxDescriptors as unknown as JsxComponentDescriptor[],
    }),
    linkPlugin(),
    imagePlugin(),
    tablePlugin(),
    codeBlockPlugin({ defaultCodeBlockLanguage: '' }),
    codeMirrorPlugin({
      codeBlockLanguages: {
        '': 'Plain text',
        js: 'JavaScript',
        ts: 'TypeScript',
        tsx: 'TSX',
        json: 'JSON',
        css: 'CSS',
        html: 'HTML',
        bash: 'Shell',
        python: 'Python',
        sql: 'SQL',
      },
      autoLoadLanguageSupport: false,
    }),
  ];
}

export async function waitForLexicalCommit(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export async function createHeadlessDocumentEditor(): Promise<HeadlessDocumentEditor> {
  const lexicalRuntime: typeof import('lexical') =
    process.env.DOCUMENT_CODEC_COMMONJS === '1'
      ? require('lexical')
      : await import('lexical');
  const { $createParagraphNode, $getRoot } = lexicalRuntime;
  const realm = new Realm();
  const plugins = documentPlugins();
  for (const plugin of plugins) plugin.init?.(realm);
  for (const plugin of plugins) plugin.postInit?.(realm);
  await waitForLexicalCommit();

  const editor = realm.getValue(rootEditor$);
  if (!editor) {
    throw new Error('Headless document editor did not initialize');
  }

  return {
    editor,
    clear() {
      editor.update(() => $getRoot().clear(), { discrete: true });
    },
    appendEmptyParagraph() {
      editor.update(
        () => $getRoot().append($createParagraphNode()),
        { discrete: true }
      );
    },
    getMarkdown: () => realm.getValue(markdown$),
    async setMarkdown(markdown: string) {
      realm.pub(setMarkdown$, markdown);
      await waitForLexicalCommit();
      const processingError = realm.getValue(markdownProcessingError$);
      if (processingError) {
        throw new Error(processingError.error);
      }
    },
  };
}
