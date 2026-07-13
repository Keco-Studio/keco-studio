'use client';

/**
 * The actual MDXEditor instance. This module is the ONLY place that imports
 * @mdxeditor/editor (and its CSS), and it is loaded via next/dynamic with
 * ssr:false from DocumentEditor so the large Lexical-based editor bundle stays
 * out of the main dashboard chunk (GitHub #213 principle).
 */

import type { Ref } from 'react';
import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  markdownShortcutPlugin,
  linkPlugin,
  linkDialogPlugin,
  imagePlugin,
  tablePlugin,
  codeBlockPlugin,
  codeMirrorPlugin,
  toolbarPlugin,
  UndoRedo,
  BoldItalicUnderlineToggles,
  BlockTypeSelect,
  CreateLink,
  InsertImage,
  InsertTable,
  ListsToggle,
  InsertThematicBreak,
  InsertCodeBlock,
  CodeToggle,
  Separator,
  type MDXEditorMethods,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';
import type { Doc } from 'yjs';
import type { Provider } from '@lexical/yjs';
import {
  documentCollaborationPlugin,
} from './documentCollaborationPlugin';
import styles from './MdxDocumentEditor.module.css';

export type MdxDocumentEditorProps = {
  markdown: string;
  readOnly: boolean;
  onChange: (markdown: string) => void;
  /** Uploads an image file and resolves to its public URL for the editor. */
  imageUploadHandler: (image: File) => Promise<string>;
  /** When set, enables Yjs co-editing + awareness cursors. */
  collaboration?: {
    documentId: string;
    provider: Provider;
    doc: Doc;
    username: string;
    cursorColor: string;
    shouldBootstrapFromEditor: boolean;
  };
  editorRef?: Ref<MDXEditorMethods | null>;
};

const CODE_BLOCK_LANGUAGES = {
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
};

export default function MdxDocumentEditor({
  markdown,
  readOnly,
  onChange,
  imageUploadHandler,
  collaboration,
  editorRef,
}: MdxDocumentEditorProps) {
  const plugins = [
    headingsPlugin(),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    linkPlugin(),
    linkDialogPlugin(),
    imagePlugin({ imageUploadHandler }),
    tablePlugin(),
    codeBlockPlugin({ defaultCodeBlockLanguage: '' }),
    codeMirrorPlugin({ codeBlockLanguages: CODE_BLOCK_LANGUAGES }),
    markdownShortcutPlugin(),
  ];

  if (collaboration) {
    plugins.push(
      documentCollaborationPlugin({
        id: collaboration.documentId,
        provider: collaboration.provider,
        doc: collaboration.doc,
        username: collaboration.username,
        cursorColor: collaboration.cursorColor,
        shouldBootstrapFromEditor: collaboration.shouldBootstrapFromEditor,
      })
    );
  }

  if (!readOnly) {
    plugins.push(
      toolbarPlugin({
        toolbarContents: () => (
          <>
            <UndoRedo />
            <Separator />
            <BoldItalicUnderlineToggles />
            <CodeToggle />
            <Separator />
            <BlockTypeSelect />
            <Separator />
            <ListsToggle />
            <Separator />
            <CreateLink />
            <InsertImage />
            <Separator />
            <InsertTable />
            <InsertThematicBreak />
            <InsertCodeBlock />
          </>
        ),
      })
    );
  }

  return (
    <MDXEditor
      ref={editorRef}
      markdown={markdown}
      readOnly={readOnly}
      onChange={onChange}
      plugins={plugins}
      suppressSharedHistory={Boolean(collaboration)}
      contentEditableClassName={styles.contentEditable}
      className={styles.editor}
    />
  );
}
