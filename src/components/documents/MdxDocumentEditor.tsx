'use client';

/**
 * The actual MDXEditor instance. This module is the ONLY place that imports
 * @mdxeditor/editor (and its CSS), and it is loaded via next/dynamic with
 * ssr:false from DocumentEditor so the large Lexical-based editor bundle stays
 * out of the main dashboard chunk (GitHub #213 principle).
 */

import {
  useEffect,
  useMemo,
  useRef,
  type ChangeEvent,
  type ComponentType,
  type MouseEvent,
  type Ref,
} from 'react';
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
  CodeMirrorEditor,
  GenericJsxEditor,
  PropertyPopover,
  activeEditor$,
  currentSelection$,
  iconComponentFor$,
  insertImage$,
  openLinkEditDialog$,
  useCellValue,
  usePublisher,
  type MDXEditorMethods,
  type CodeBlockEditorProps,
  type JsxComponentDescriptor,
  type JsxEditorProps,
  jsxPlugin,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';
import { EditorView } from '@codemirror/view';
import { $getSelection, $isRangeSelection } from 'lexical';
import type { DocumentCollaborationSession } from '@/lib/documents/documentCollaborationSession';
import {
  documentCollaborationPlugin,
} from './documentCollaborationPlugin';
import styles from './MdxDocumentEditor.module.css';
import {
  createSanctionedMdxDescriptors,
  type SanctionedMdxEditorProps,
} from '@/lib/documents/sanctionedMdxDescriptors';
import { syncCodeMirrorDocument } from './codeMirrorDocumentSync';
import {
  SanctionedMdxPropertyEditor,
  type SanctionedMdxPropertyEditorControlProps,
} from './SanctionedMdxPropertyEditor';

export type { MDXEditorMethods } from '@mdxeditor/editor';

export type MdxDocumentEditorProps = {
  markdown: string;
  readOnly: boolean;
  showToolbar: boolean;
  onChange: (markdown: string) => void;
  /** Uploads an image file and resolves to its public URL for the editor. */
  imageUploadHandler: (image: File) => Promise<string>;
  /** When set, enables Yjs co-editing + awareness cursors. */
  collaboration?: {
    session: DocumentCollaborationSession;
    username: string;
    cursorColor: string;
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

function BoundSanctionedMdxPropertyEditor(
  props: SanctionedMdxPropertyEditorControlProps
) {
  return (
    <SanctionedMdxPropertyEditor
      {...props}
      PropertyEditorComponent={PropertyPopover}
    />
  );
}

function SanctionedMdxEditor(props: JsxEditorProps) {
  return (
    <div
      className={styles.sanctionedMdx}
      data-component={props.mdastNode.name ?? undefined}
    >
      <GenericJsxEditor
        {...props}
        PropertyEditor={BoundSanctionedMdxPropertyEditor}
      />
    </div>
  );
}

const sanctionedMdxDescriptors = createSanctionedMdxDescriptors(
  SanctionedMdxEditor as unknown as ComponentType<SanctionedMdxEditorProps>
);

function SyncedCodeMirrorEditor(props: CodeBlockEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const syncMountedView = () => {
      const view = EditorView.findFromDOM(container);
      if (!view) return false;
      syncCodeMirrorDocument(view, props.code);
      return true;
    };

    if (syncMountedView()) return;

    const observer = new MutationObserver(() => {
      if (syncMountedView()) observer.disconnect();
    });
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [props.code]);

  return (
    <div ref={containerRef}>
      <CodeMirrorEditor {...props} />
    </div>
  );
}

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
  showToolbar,
  onChange,
  imageUploadHandler,
  collaboration,
  editorRef,
}: MdxDocumentEditorProps) {
  const collaborationSession = collaboration?.session;
  const collaborationUsername = collaboration?.username;
  const collaborationCursorColor = collaboration?.cursorColor;
  const plugins = useMemo(() => {
    const stablePlugins = [
      headingsPlugin(),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      linkPlugin(),
      linkDialogPlugin({ showLinkTitleField: false }),
      imagePlugin({ imageUploadHandler, disableImageSettingsButton: true }),
      tablePlugin(),
      codeBlockPlugin({
        defaultCodeBlockLanguage: '',
        codeBlockEditorDescriptors: [
          {
            match: (language, meta) =>
              !meta || Object.hasOwn(CODE_BLOCK_LANGUAGES, language ?? ''),
            priority: 2,
            Editor: SyncedCodeMirrorEditor,
          },
        ],
      }),
      codeMirrorPlugin({ codeBlockLanguages: CODE_BLOCK_LANGUAGES }),
      markdownShortcutPlugin(),
      jsxPlugin({
        jsxComponentDescriptors:
          sanctionedMdxDescriptors as unknown as JsxComponentDescriptor[],
      }),
    ];

    if (
      collaborationSession &&
      collaborationUsername &&
      collaborationCursorColor
    ) {
      stablePlugins.push(
        documentCollaborationPlugin({
          session: collaborationSession,
          username: collaborationUsername,
          cursorColor: collaborationCursorColor,
        })
      );
    }

    if (showToolbar) {
      stablePlugins.push(
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

    return stablePlugins;
  }, [
    collaborationCursorColor,
    collaborationSession,
    collaborationUsername,
    imageUploadHandler,
    showToolbar,
  ]);

  return (
    <div className={styles.editorFrame} onDoubleClick={handleLinkDoubleClick}>
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
