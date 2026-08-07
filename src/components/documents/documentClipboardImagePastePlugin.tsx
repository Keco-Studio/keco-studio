import { useEffect } from 'react';
import { Cell } from '@mdxeditor/gurx';
import {
  $createImageNode,
  addComposerChild$,
  insertImage$,
  realmPlugin,
  useCellValue,
  usePublisher,
} from '@mdxeditor/editor';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $wrapNodeInElement } from '@lexical/utils';
import {
  $createParagraphNode,
  $getNodeByKey,
  $getSelection,
  $insertNodes,
  $isElementNode,
  $isNodeSelection,
  $isRangeSelection,
  $isRootOrShadowRoot,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_CRITICAL,
  PASTE_COMMAND,
  SKIP_DOM_SELECTION_TAG,
  type BaseSelection,
  type LexicalEditor,
  type RangeSelection,
} from 'lexical';
import {
  extractClipboardImageFiles,
  uploadClipboardImages,
} from './documentClipboardImages';

type ImageUploadHandler = (file: File) => Promise<string>;

export type DocumentClipboardImagePastePluginParams = {
  imageUploadHandler: ImageUploadHandler;
};

const clipboardImageUploadHandler$ = Cell<ImageUploadHandler | null>(null);

function capturePasteSelection(): RangeSelection | null {
  const selection = $getSelection();
  if ($isRangeSelection(selection)) return selection.clone();
  if (!$isNodeSelection(selection)) return null;
  const selectedNodes = selection.getNodes();
  const lastNode = selectedNodes[selectedNodes.length - 1];
  return lastNode ? lastNode.selectNext().clone() : null;
}

function normalizeRangeSelection(
  selection: RangeSelection
): RangeSelection | null {
  const normalized = selection.clone();
  for (const point of [normalized.anchor, normalized.focus]) {
    const node = $getNodeByKey(point.key);
    if (point.type === 'text') {
      if (!$isTextNode(node)) return null;
      point.set(node.getKey(), Math.min(point.offset, node.getTextContentSize()), 'text');
    } else {
      if (!$isElementNode(node)) return null;
      point.set(node.getKey(), Math.min(point.offset, node.getChildrenSize()), 'element');
    }
  }
  return normalized;
}

function restoreSelection(selection: BaseSelection | null): void {
  if ($isRangeSelection(selection)) {
    $setSelection(normalizeRangeSelection(selection));
  } else {
    $setSelection(selection?.clone() ?? null);
  }
}

function insertImagesAtPasteSelection(
  editor: LexicalEditor,
  images: Awaited<ReturnType<typeof uploadClipboardImages>>,
  pasteSelection: RangeSelection,
  currentSelection: BaseSelection | null
): void {
  editor.update(() => {
    const insertionSelection = normalizeRangeSelection(pasteSelection);
    if (!insertionSelection) return;
    $setSelection(insertionSelection);

    images.forEach((image) => {
      const imageNode = $createImageNode({
        src: image.url,
        altText: image.file.name,
      });
      $insertNodes([imageNode]);
      if ($isRootOrShadowRoot(imageNode.getParentOrThrow())) {
        $wrapNodeInElement(imageNode, $createParagraphNode).selectEnd();
      }
    });

    restoreSelection(currentSelection);
  }, { discrete: true, tag: SKIP_DOM_SELECTION_TAG });
}

function DocumentClipboardImagePaste() {
  const [editor] = useLexicalComposerContext();
  const imageUploadHandler = useCellValue(clipboardImageUploadHandler$);
  const insertImage = usePublisher(insertImage$);

  useEffect(() => {
    let active = true;
    const unregister = editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        if (!editor.isEditable() || !imageUploadHandler) return false;
        const clipboardData = 'clipboardData' in event ? event.clipboardData : null;
        const imageFiles = extractClipboardImageFiles(clipboardData);
        if (imageFiles.length === 0) return false;
        const pasteSelection = capturePasteSelection();
        if (!pasteSelection) return false;

        event.preventDefault();
        void uploadClipboardImages(imageFiles, imageUploadHandler).then((images) => {
          if (!active || images.length === 0) return;
          const rootElement = editor.getRootElement();
          const rootHadFocus = rootElement?.contains(
            rootElement.ownerDocument.activeElement
          ) ?? false;
          const currentSelection = editor.getEditorState().read(
            () => $getSelection()?.clone() ?? null
          );
          const selectionMoved = !pasteSelection.is(currentSelection);

          if (rootHadFocus && !selectionMoved) {
            images.forEach((image) => {
              insertImage({ src: image.url, altText: image.file.name });
            });
            return;
          }

          insertImagesAtPasteSelection(
            editor,
            images,
            pasteSelection,
            currentSelection
          );
        });
        return true;
      },
      COMMAND_PRIORITY_CRITICAL
    );

    return () => {
      active = false;
      unregister();
    };
  }, [editor, imageUploadHandler, insertImage]);

  return null;
}

export const documentClipboardImagePastePlugin =
  realmPlugin<DocumentClipboardImagePastePluginParams>({
    init(realm, params) {
      if (!params) return;
      realm.pubIn({
        [addComposerChild$]: DocumentClipboardImagePaste,
        [clipboardImageUploadHandler$]: params.imageUploadHandler,
      });
    },
    update(realm, params) {
      if (params) {
        realm.pub(clipboardImageUploadHandler$, params.imageUploadHandler);
      }
    },
  });
