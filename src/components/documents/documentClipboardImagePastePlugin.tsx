import { useEffect } from 'react';
import { Cell } from '@mdxeditor/gurx';
import {
  $createImageNode,
  $isImageNode,
  ImageNode,
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
  $nodesOfType,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  PASTE_COMMAND,
  SKIP_DOM_SELECTION_TAG,
  type BaseSelection,
  type LexicalEditor,
  type RangeSelection,
} from 'lexical';
import { $insertDataTransferForRichText } from '@lexical/clipboard';
import {
  extractClipboardImageFiles,
  hasClipboardImagePayload,
  hasClipboardTextPayload,
  prepareClipboardRichImagePaste,
  type PreparedClipboardRichImagePaste,
  uploadPreparedClipboardImages,
  uploadClipboardImages,
} from './documentClipboardImages';

export { hasClipboardTextPayload } from './documentClipboardImages';

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

function richClipboardData(
  payload: Pick<PreparedClipboardRichImagePaste, 'html' | 'plainText'>,
): Pick<DataTransfer, 'getData'> {
  return {
    getData(format: string) {
      if (format === 'application/x-lexical-editor') return '';
      if (format === 'text/html') return payload.html;
      if (format === 'text/plain') return payload.plainText;
      return '';
    },
  };
}

function insertRichPasteWithPlaceholders(
  editor: LexicalEditor,
  payload: PreparedClipboardRichImagePaste,
  imageUploadHandler: ImageUploadHandler,
  isActive: () => boolean,
): void {
  const selection = $getSelection();
  if (!selection) return;
  const previousImageKeys = new Set($nodesOfType(ImageNode).map((node) => node.getKey()));
  $insertDataTransferForRichText(
    richClipboardData(payload) as DataTransfer,
    selection,
    editor,
  );
  const insertedImageKeys = new Map(
    $nodesOfType(ImageNode)
      .filter((node) => !previousImageKeys.has(node.getKey()))
      .map((node) => [node.getSrc(), node.getKey()]),
  );

  void uploadPreparedClipboardImages(payload.images, imageUploadHandler).then((results) => {
    if (!isActive()) return;
    editor.update(() => {
      results.forEach((result) => {
        const nodeKey = insertedImageKeys.get(result.placeholderSrc);
        if (!nodeKey) return;
        const node = $getNodeByKey(nodeKey);
        if (!$isImageNode(node)) return;
        if (result.url) node.setSrc(result.url);
        else node.remove();
      });
    }, { discrete: true, tag: SKIP_DOM_SELECTION_TAG });
  });
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
        if (!clipboardData || !hasClipboardImagePayload(clipboardData)) return false;
        const imageFiles = extractClipboardImageFiles(clipboardData);
        const hasTextPayload = hasClipboardTextPayload(clipboardData);
        if (/<img\b/i.test(clipboardData.getData('text/html'))) {
          const payload = prepareClipboardRichImagePaste(clipboardData);
          if (!payload || !$getSelection()) return false;
          event.preventDefault();
          insertRichPasteWithPlaceholders(
            editor,
            payload,
            imageUploadHandler,
            () => active,
          );
          return true;
        }

        const pasteSelection = capturePasteSelection();
        if (!pasteSelection) return false;
        event.preventDefault();

        if (hasTextPayload && clipboardData) {
          editor.update(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
              $insertDataTransferForRichText(
                richClipboardData({
                  html: clipboardData.getData('text/html'),
                  plainText: clipboardData.getData('text/plain'),
                }) as DataTransfer,
                selection,
                editor,
              );
            }
          }, { tag: 'paste' });
        }
        void uploadClipboardImages(imageFiles, imageUploadHandler).then((images) => {
          if (!active || images.length === 0) return;
          const rootElement = editor.getRootElement();
          const rootHadFocus = rootElement?.contains(
            rootElement.ownerDocument.activeElement
          ) ?? false;
          const currentSelection = editor.getEditorState().read(
            () => $getSelection()?.clone() ?? null
          );

          if (hasTextPayload && rootHadFocus && currentSelection) {
            images.forEach((image) => {
              insertImage({ src: image.url, altText: image.file.name });
            });
            return;
          }

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
      COMMAND_PRIORITY_HIGH
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
