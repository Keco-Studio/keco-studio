import {
  $createHeadingNode,
  $isHeadingNode,
  HeadingNode,
} from '@lexical/rich-text';
import {
  $copyNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $getState,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  $setState,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import {
  documentBlockIdState,
  listDocumentReferenceBlocks,
  normalizeDocumentBlockIds,
  registerDocumentBlockIdentity,
} from '@/lib/documents/documentBlockIdentity';

type BlockInput =
  | { type: 'heading'; text: string; level?: 1 | 2 | 3 | 4 | 5 | 6 }
  | { type: 'paragraph'; text: string };

function normalizedEditor(...inputs: BlockInput[]): LexicalEditor {
  const editor = createEditor({ nodes: [HeadingNode] });
  editor.update(
    () => {
      const root = $getRoot();
      for (const input of inputs) {
        const node =
          input.type === 'heading'
            ? $createHeadingNode(`h${input.level ?? 1}`)
            : $createParagraphNode();
        node.append($createTextNode(input.text));
        root.append(node);
      }
      normalizeDocumentBlockIds();
    },
    { discrete: true }
  );
  return editor;
}

function blocks(editor: LexicalEditor) {
  return editor.getEditorState().read(() => listDocumentReferenceBlocks());
}

describe('document block identity', () => {
  it('starts assigning IDs through the plugin update lifecycle without remounting', async () => {
    const addExportVisitor$ = Symbol('addExportVisitor');
    const addImportVisitor$ = Symbol('addImportVisitor');
    const createRootEditorSubscription$ = Symbol('rootSubscription');
    const rootEditor$ = Symbol('rootEditor');

    jest.doMock('@mdxeditor/gurx', () => ({
      Cell: () => Symbol('cell'),
    }));
    jest.doMock('@mdxeditor/editor', () => ({
      addExportVisitor$,
      addImportVisitor$,
      createRootEditorSubscription$,
      rootEditor$,
      realmPlugin:
        (definition: {
          init?: (realm: unknown, params?: unknown) => void;
          update?: (realm: unknown, params?: unknown) => void;
        }) =>
        (params?: unknown) => ({
          init: (realm: unknown) => definition.init?.(realm, params),
          update: (realm: unknown) => definition.update?.(realm, params),
        }),
    }));

    const { documentBlockIdentityPlugin } = await import(
      '@/components/documents/documentBlockIdentityPlugin'
    );
    const editor = createEditor({ nodes: [HeadingNode] });
    const values = new Map<unknown, unknown>([[rootEditor$, editor]]);
    let subscribeToRoot: ((editor: LexicalEditor) => () => void) | undefined;
    const realm = {
      getValue: (ref: unknown) => values.get(ref),
      pub: (ref: unknown, value: unknown) => {
        values.set(ref, value);
        if (ref === createRootEditorSubscription$) {
          subscribeToRoot = value as typeof subscribeToRoot;
        }
      },
      pubIn: () => undefined,
    };

    documentBlockIdentityPlugin({ assignMissingIds: false }).init?.(
      realm as never
    );
    expect(subscribeToRoot).toEqual(expect.any(Function));
    const unregister = subscribeToRoot?.(editor);
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode('Read only draft'))
        );
      },
      { discrete: true }
    );
    expect(blocks(editor)).toEqual([]);

    documentBlockIdentityPlugin({ assignMissingIds: true }).update?.(
      realm as never
    );
    expect(blocks(editor)).toHaveLength(1);
    expect(blocks(editor)[0]).toMatchObject({
      blockType: 'paragraph',
      text: 'Read only draft',
    });
    expect(
      editor.getEditorState().read(() => $getRoot().getTextContent())
    ).toBe('Read only draft');

    unregister?.();
    jest.dontMock('@mdxeditor/gurx');
    jest.dontMock('@mdxeditor/editor');
  });

  it('repairs a duplicate ID on the final empty paragraph', () => {
    const duplicateId = '33333333-3333-4333-8333-333333333333';
    const editor = createEditor({ nodes: [HeadingNode] });
    editor.update(
      () => {
        const first = $createParagraphNode().append($createTextNode('First'));
        const empty = $createParagraphNode();
        $setState(first, documentBlockIdState, duplicateId);
        $setState(empty, documentBlockIdState, duplicateId);
        $getRoot().append(first, empty);
        normalizeDocumentBlockIds();
      },
      { discrete: true }
    );

    const [firstId, emptyId] = editor.getEditorState().read(() =>
      $getRoot().getChildren().map((node) =>
        $getState(node, documentBlockIdState)
      )
    );
    expect(firstId).toBe(duplicateId);
    expect(emptyId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(emptyId).not.toBe(duplicateId);
  });

  it('lists top-level blocks with collapsed text and nearest headings', async () => {
    const editor = normalizedEditor(
      { type: 'heading', text: '  Chapter' },
      { type: 'paragraph', text: 'First   paragraph\nwith a line.' },
      { type: 'heading', text: 'Section', level: 2 },
      { type: 'paragraph', text: 'Second paragraph.' }
    );

    expect(blocks(editor).map(({ blockType, text, headingLevel, nearestHeading }) => ({
      blockType,
      text,
      headingLevel,
      nearestHeading,
    }))).toEqual([
      {
        blockType: 'heading',
        text: 'Chapter',
        headingLevel: 1,
        nearestHeading: undefined,
      },
      {
        blockType: 'paragraph',
        text: 'First paragraph with a line.',
        headingLevel: undefined,
        nearestHeading: 'Chapter',
      },
      {
        blockType: 'heading',
        text: 'Section',
        headingLevel: 2,
        nearestHeading: undefined,
      },
      {
        blockType: 'paragraph',
        text: 'Second paragraph.',
        headingLevel: undefined,
        nearestHeading: 'Section',
      },
    ]);
    expect(new Set(blocks(editor).map(({ blockId }) => blockId)).size).toBe(4);
  });

  it('assigns IDs automatically through permission-gated node transforms', () => {
    const editor = createEditor({ nodes: [HeadingNode] });
    let assignMissingIds = false;
    const unregister = registerDocumentBlockIdentity(
      editor,
      () => assignMissingIds
    );

    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode('Draft'))
        );
      },
      { discrete: true }
    );
    expect(
      editor.getEditorState().read(() => {
        const paragraph = $getRoot().getFirstChild();
        if (!$isParagraphNode(paragraph)) throw new Error('Expected paragraph');
        return $getState(paragraph, documentBlockIdState);
      })
    ).toBe('');

    assignMissingIds = true;
    editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild();
        if (!$isParagraphNode(paragraph)) throw new Error('Expected paragraph');
        paragraph.append($createTextNode(' ready'));
        $getRoot().append($createParagraphNode());
      },
      { discrete: true }
    );

    expect(blocks(editor)[0]?.blockId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(
      editor.getEditorState().read(() => {
        const empty = $getRoot().getLastChild();
        if (!$isParagraphNode(empty)) throw new Error('Expected empty paragraph');
        return $getState(empty, documentBlockIdState);
      })
    ).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    unregister();
  });

  it('cleans DOM markers when the root changes and when behavior is disposed', () => {
    const editor = normalizedEditor({ type: 'paragraph', text: 'Marked' });
    const paragraphKey = editor.getEditorState().read(() =>
      $getRoot().getFirstChildOrThrow().getKey()
    );
    const oldElement = { dataset: {} } as HTMLElement;
    const newElement = { dataset: {} } as HTMLElement;
    const oldRoot = {
      querySelectorAll: () => [oldElement],
    } as unknown as HTMLElement;
    const newRoot = {
      querySelectorAll: () => [newElement],
    } as unknown as HTMLElement;
    let currentRoot: HTMLElement | null = null;
    let rootListener:
      | ((nextRoot: HTMLElement | null, previousRoot: HTMLElement | null) => void)
      | undefined;

    jest.spyOn(editor, 'getRootElement').mockImplementation(() => currentRoot);
    jest.spyOn(editor, 'getElementByKey').mockImplementation((key) =>
      key === paragraphKey
        ? currentRoot === oldRoot
          ? oldElement
          : newElement
        : null
    );
    jest.spyOn(editor, 'registerRootListener').mockImplementation((listener) => {
      rootListener = listener;
      listener(currentRoot, null);
      return () => undefined;
    });

    const unregister = registerDocumentBlockIdentity(editor, () => false);
    currentRoot = oldRoot;
    rootListener?.(oldRoot, null);
    expect(oldElement.dataset.documentBlockId).toEqual(expect.any(String));
    expect(oldElement.dataset.documentBlockType).toBe('paragraph');

    currentRoot = newRoot;
    rootListener?.(newRoot, oldRoot);
    expect(oldElement.dataset).toEqual({});
    expect(newElement.dataset.documentBlockId).toEqual(expect.any(String));

    unregister();
    expect(newElement.dataset).toEqual({});
  });

  it('preserves IDs when text changes or a whole block moves', async () => {
    const editor = normalizedEditor(
      { type: 'heading', text: 'Heading' },
      { type: 'paragraph', text: 'First' },
      { type: 'paragraph', text: 'Second' }
    );
    const before = new Map(blocks(editor).map((block) => [block.text, block.blockId]));

    editor.update(
      () => {
        const [heading, first, second] = $getRoot().getChildren();
        if (!$isHeadingNode(heading) || !$isParagraphNode(first) || !$isParagraphNode(second)) {
          throw new Error('Expected heading and paragraph blocks');
        }
        const text = first.getFirstChild();
        if (!$isTextNode(text)) throw new Error('Expected paragraph text');
        text.setTextContent('First edited');
        second.insertAfter(first);
        normalizeDocumentBlockIds();
      },
      { discrete: true }
    );

    const after = blocks(editor);
    expect(after.map(({ text }) => text)).toEqual([
      'Heading',
      'Second',
      'First edited',
    ]);
    expect(after.find(({ text }) => text === 'First edited')?.blockId).toBe(
      before.get('First')
    );
    expect(after.find(({ text }) => text === 'Second')?.blockId).toBe(
      before.get('Second')
    );
  });

  it('keeps the leading ID and assigns a new trailing ID when splitting', async () => {
    const editor = normalizedEditor({
      type: 'paragraph',
      text: 'Leading trailing',
    });
    const originalId = blocks(editor)[0]?.blockId;

    editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild();
        if (!$isParagraphNode(paragraph)) throw new Error('Expected paragraph');
        const text = paragraph.getFirstChild();
        if (!$isTextNode(text)) throw new Error('Expected paragraph text');
        text.select(7, 7);
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) throw new Error('Expected range selection');
        selection.insertParagraph();
        normalizeDocumentBlockIds();
      },
      { discrete: true }
    );

    const [leading, trailing] = blocks(editor);
    expect(leading).toMatchObject({ text: 'Leading', blockId: originalId });
    expect(trailing.text).toBe('trailing');
    expect(trailing.blockId).not.toBe(originalId);
  });

  it('keeps the destination ID and removes the source ID when merging', async () => {
    const editor = normalizedEditor(
      { type: 'paragraph', text: 'Destination' },
      { type: 'paragraph', text: 'Source' }
    );
    const [destinationBefore, sourceBefore] = blocks(editor);

    editor.update(
      () => {
        const [destination, source] = $getRoot().getChildren();
        if (!$isParagraphNode(destination) || !$isParagraphNode(source)) {
          throw new Error('Expected paragraph blocks');
        }
        destination.append($createTextNode(' '), ...source.getChildren());
        source.remove();
        normalizeDocumentBlockIds();
      },
      { discrete: true }
    );

    const merged = blocks(editor);
    expect(merged[0]).toMatchObject({
      text: 'Destination Source',
      blockId: destinationBefore.blockId,
    });
    expect(merged.map(({ blockId }) => blockId)).not.toContain(sourceBefore.blockId);
  });

  it('regenerates the later duplicate ID when copying a block', async () => {
    const editor = normalizedEditor({ type: 'paragraph', text: 'Copy me' });
    const originalId = blocks(editor)[0]?.blockId;

    editor.update(
      () => {
        const original = $getRoot().getFirstChild();
        if (!$isParagraphNode(original)) throw new Error('Expected paragraph');
        const copy = $copyNode(original);
        copy.append(...original.getChildren().map((child) => $copyNode(child)));
        original.insertAfter(copy);
        normalizeDocumentBlockIds();
      },
      { discrete: true }
    );

    const copied = blocks(editor);
    expect(copied).toHaveLength(2);
    expect(copied[0].blockId).toBe(originalId);
    expect(copied[1].blockId).not.toBe(originalId);
  });

  it('removes a deleted block ID', async () => {
    const editor = normalizedEditor(
      { type: 'paragraph', text: 'Keep' },
      { type: 'paragraph', text: 'Delete' }
    );
    const deletedId = blocks(editor).find(({ text }) => text === 'Delete')?.blockId;

    editor.update(
      () => {
        const deleted = $getRoot().getChildren()[1];
        deleted?.remove();
        normalizeDocumentBlockIds();
      },
      { discrete: true }
    );
    expect(blocks(editor).map(({ blockId }) => blockId)).not.toContain(deletedId);
  });
});
