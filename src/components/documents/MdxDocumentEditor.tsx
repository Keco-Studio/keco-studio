'use client';

/**
 * The actual MDXEditor instance. This module is the ONLY place that imports
 * @mdxeditor/editor (and its CSS), and it is loaded via next/dynamic with
 * ssr:false from DocumentEditor so the large Lexical-based editor bundle stays
 * out of the main dashboard chunk (GitHub #213 principle).
 */

import { useRef, type ChangeEvent, type MouseEvent, type Ref } from 'react';
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
  ButtonWithTooltip,
  UndoRedo,
  BoldItalicUnderlineToggles,
  BlockTypeSelect,
  InsertTable,
  ListsToggle,
  InsertThematicBreak,
  InsertCodeBlock,
  CodeToggle,
  Separator,
  activeEditor$,
  currentSelection$,
  iconComponentFor$,
  insertImage$,
  openLinkEditDialog$,
  useCellValue,
  usePublisher,
  type MDXEditorMethods,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';
import { $getSelection, $isRangeSelection } from 'lexical';
import type { Doc } from 'yjs';
import type { Provider } from '@lexical/yjs';
import {
  documentCollaborationPlugin,
} from './documentCollaborationPlugin';
import styles from './MdxDocumentEditor.module.css';

export type { MDXEditorMethods } from '@mdxeditor/editor';

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

function SelectedTextLinkButton() {
  const selection = useCellValue(currentSelection$);
  const iconComponentFor = useCellValue(iconComponentFor$);
  const openLinkDialog = usePublisher(openLinkEditDialog$);

  return (
    <ButtonWithTooltip
      type="button"
      title="Create link from selected text"
      disabled={!selection || selection.isCollapsed()}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => openLinkDialog()}
    >
      {iconComponentFor('link')}
    </ButtonWithTooltip>
  );
}

function SingleFileImageButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const activeEditor = useCellValue(activeEditor$);
  const iconComponentFor = useCellValue(iconComponentFor$);
  const insertImage = usePublisher(insertImage$);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.item(0);
    event.target.value = '';
    if (!file) return;
    activeEditor?.update(
      () => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || selection.isCollapsed()) return;
        const end = selection.isBackward() ? selection.anchor : selection.focus;
        const { key, offset, type } = end;
        selection.anchor.set(key, offset, type);
        selection.focus.set(key, offset, type);
      },
      { discrete: true }
    );
    insertImage({ file, altText: '' });
  };

  return (
    <>
      <ButtonWithTooltip
        type="button"
        title="Insert image"
        onClick={() => inputRef.current?.click()}
      >
        {iconComponentFor('add_photo')}
      </ButtonWithTooltip>
      <input
        ref={inputRef}
        className={styles.hiddenFileInput}
        type="file"
        accept="image/*"
        aria-label="Choose image to insert"
        onChange={handleFileChange}
      />
    </>
  );
}

function handleLinkDoubleClick(event: MouseEvent<HTMLDivElement>) {
  const target = event.target instanceof Element ? event.target : null;
  const link = target?.closest<HTMLAnchorElement>('a[href]');
  if (!link) return;

  const href = link.href;
  const protocol = new URL(href, window.location.href).protocol;
  if (protocol !== 'http:' && protocol !== 'https:') return;

  event.preventDefault();
  window.open(href, '_blank', 'noopener,noreferrer');
}

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
    linkDialogPlugin({ showLinkTitleField: false }),
    imagePlugin({ imageUploadHandler, disableImageSettingsButton: true }),
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
            <SelectedTextLinkButton />
            <SingleFileImageButton />
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
    <div onDoubleClick={handleLinkDoubleClick}>
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
    </div>
  );
}
