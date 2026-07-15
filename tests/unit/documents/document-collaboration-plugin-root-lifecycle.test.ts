type RootListener = (
  nextRoot: HTMLElement | null,
  previousRoot: HTMLElement | null
) => void;

class FakeElement {
  parentElement: FakeElement | null = null;
  parentNode: FakeElement | null = null;
  children: FakeElement[] = [];
  className = '';

  appendChild(child: FakeElement): FakeElement {
    child.remove();
    this.children.push(child);
    child.parentElement = this;
    child.parentNode = this;
    return child;
  }

  removeChild(child: FakeElement): FakeElement {
    const index = this.children.indexOf(child);
    if (index === -1) throw new Error('child is not attached');
    this.children.splice(index, 1);
    child.parentElement = null;
    child.parentNode = null;
    return child;
  }

  remove(): void {
    this.parentElement?.removeChild(this);
  }

  setAttribute(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

const mockSharedRoot = {
  observeDeep: jest.fn(),
  unobserveDeep: jest.fn(),
};
const mockBinding = {
  clientID: 1,
  collabNodeMap: new Map(),
  cursors: new Map(),
  cursorsContainer: null as FakeElement | null,
  doc: {},
  docMap: new Map(),
  editor: null as unknown,
  excludedProperties: new Map(),
  id: 'document-1',
  nodeProperties: new Map(),
  root: {
    destroy: jest.fn(),
    getSharedType: () => mockSharedRoot,
  },
};
const mockUndoManager = {
  destroy: jest.fn(),
  off: jest.fn(),
  on: jest.fn(),
  redo: jest.fn(),
  redoStack: [],
  undo: jest.fn(),
  undoStack: [],
};
let mockRootListener: RootListener | null = null;
let mockEffectCleanup: (() => void) | undefined;
let mockAwarenessUpdate: (() => void) | null = null;
const mockEditor = {
  dispatchCommand: jest.fn(),
  getEditorState: jest.fn(() => ({})),
  isComposing: jest.fn(() => false),
  registerCommand: jest.fn(() => jest.fn()),
  registerRootListener: jest.fn((listener: RootListener) => {
    mockRootListener = listener;
    return jest.fn();
  }),
  registerUpdateListener: jest.fn(() => jest.fn()),
};
mockBinding.editor = mockEditor;
const mockSession = {
  attachBinding: jest.fn(),
  setSemanticStateValidator: jest.fn(),
  awareness: {
    getLocalState: jest.fn(() => null),
    getStates: jest.fn(() => new Map()),
    off: jest.fn(),
    on: jest.fn((event: string, listener: () => void) => {
      if (event === 'update') mockAwarenessUpdate = listener;
    }),
    setLocalState: jest.fn(),
  },
  doc: {},
  documentId: 'document-1',
  reportBindingFailure: jest.fn(),
  userId: 'user-1',
};

jest.mock('react', () => ({
  useEffect: (effect: () => (() => void) | undefined) => {
    mockEffectCleanup = effect();
  },
}));
jest.mock('@mdxeditor/editor', () => ({
  addComposerChild$: Symbol('addComposerChild'),
  realmPlugin: (config: unknown) => config,
}));
jest.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => [mockEditor],
}));
jest.mock('@lexical/yjs', () => ({
  createUndoManager: () => mockUndoManager,
  initLocalState: jest.fn(),
  setLocalStateFocus: jest.fn(),
  syncCursorPositions: jest.fn(),
  syncLexicalUpdateToYjs: jest.fn(),
  syncYjsChangesToLexical: jest.fn(),
}));
jest.mock('lexical', () => ({
  BLUR_COMMAND: Symbol('blur'),
  CAN_REDO_COMMAND: Symbol('can-redo'),
  CAN_UNDO_COMMAND: Symbol('can-undo'),
  COMMAND_PRIORITY_EDITOR: 0,
  FOCUS_COMMAND: Symbol('focus'),
  REDO_COMMAND: Symbol('redo'),
  SKIP_COLLAB_TAG: 'skip-collab',
  UNDO_COMMAND: Symbol('undo'),
}));
jest.mock('yjs', () => ({
  UndoManager: class UndoManager {},
}));
jest.mock('@/lib/documents/documentLexicalYjsBinding', () => ({
  createDocumentLexicalYjsBinding: () => mockBinding,
}));

import { documentCollaborationPlugin } from '@/components/documents/documentCollaborationPlugin';

describe('document collaboration cursor root lifecycle', () => {
  const animationFrames = new Map<number, FrameRequestCallback>();
  let nextAnimationFrame = 1;

  beforeAll(() => {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        activeElement: null,
        createElement: () => new FakeElement(),
      },
    });
    Object.defineProperty(globalThis, 'MutationObserver', {
      configurable: true,
      value: class MutationObserver {
        disconnect = jest.fn();
        observe = jest.fn();
        constructor(_callback: MutationCallback) {}
      },
    });
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        const id = nextAnimationFrame++;
        animationFrames.set(id, callback);
        return id;
      },
    });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      configurable: true,
      value: (id: number) => animationFrames.delete(id),
    });
  });

  afterAll(() => {
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { MutationObserver?: unknown }).MutationObserver;
    delete (globalThis as { requestAnimationFrame?: unknown })
      .requestAnimationFrame;
    delete (globalThis as { cancelAnimationFrame?: unknown })
      .cancelAnimationFrame;
  });

  afterEach(() => {
    mockEffectCleanup?.();
    mockEffectCleanup = undefined;
    mockRootListener = null;
    mockAwarenessUpdate = null;
    mockBinding.cursorsContainer = null;
    animationFrames.clear();
    jest.clearAllMocks();
  });

  it('preserves cursor nodes across old -> null -> new root replacement', () => {
    const realm = { pub: jest.fn() };
    const plugin = documentCollaborationPlugin as unknown as {
      init: (realm: typeof realm, params: unknown) => void;
    };
    plugin.init(realm, {
      cursorColor: '#123456',
      session: mockSession,
      username: 'Collaborator',
    });
    const Lifecycle = realm.pub.mock.calls[0]?.[1] as () => null;
    Lifecycle();

    const oldParent = new FakeElement();
    const oldRoot = new FakeElement();
    oldParent.appendChild(oldRoot);
    mockRootListener?.(
      oldRoot as unknown as HTMLElement,
      null
    );
    const cursorContainer = mockBinding.cursorsContainer;
    expect(cursorContainer).not.toBeNull();
    const remoteSelection = new FakeElement();
    cursorContainer!.appendChild(remoteSelection);

    mockRootListener?.(null, oldRoot as unknown as HTMLElement);
    expect(() => mockAwarenessUpdate?.()).not.toThrow();
    expect(mockSession.reportBindingFailure).not.toHaveBeenCalled();
    expect(mockBinding.cursorsContainer).toBe(cursorContainer);
    expect(cursorContainer!.children).toContain(remoteSelection);
    expect(animationFrames.size).toBe(0);

    const newParent = new FakeElement();
    const newRoot = new FakeElement();
    newParent.appendChild(newRoot);
    mockRootListener?.(
      newRoot as unknown as HTMLElement,
      null
    );

    expect(mockBinding.cursorsContainer).toBe(cursorContainer);
    expect(cursorContainer!.parentElement).toBe(newParent);
    expect(cursorContainer!.children).toContain(remoteSelection);
  });
});
