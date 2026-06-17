import {
  clearDraft,
  clearLastConversation,
  getAutoExecutePreference,
  getDraft,
  getLastConversationMap,
  setAutoExecutePreference,
  setDraft,
  setLastConversation,
} from '../../../src/components/agent/agentChatStorage';

const USER = 'user-abc';
const PROJECT_A = 'project-a';
const PROJECT_B = 'project-b';
const CONV_1 = 'conv-1';
const CONV_2 = 'conv-2';

/** Minimal localStorage shim for Node test environment. */
function installLocalStorageMock() {
  const store = new Map<string, string>();
  const mock: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: mock },
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  installLocalStorageMock();
});

describe('agentChatStorage draft', () => {
  it('returns empty string when no draft exists', () => {
    expect(getDraft(USER)).toBe('');
  });

  it('persists and retrieves draft text', () => {
    setDraft(USER, 'hello world');
    expect(getDraft(USER)).toBe('hello world');
  });

  it('clears draft', () => {
    setDraft(USER, 'temp');
    clearDraft(USER);
    expect(getDraft(USER)).toBe('');
  });

  it('isolates drafts by userId', () => {
    setDraft(USER, 'user-a draft');
    setDraft('user-xyz', 'user-b draft');
    expect(getDraft(USER)).toBe('user-a draft');
    expect(getDraft('user-xyz')).toBe('user-b draft');
  });
});

describe('agentChatStorage last conversation map', () => {
  it('returns empty map when none stored', () => {
    expect(getLastConversationMap(USER)).toEqual({});
  });

  it('stores per-project conversation ids', () => {
    setLastConversation(USER, PROJECT_A, CONV_1);
    setLastConversation(USER, PROJECT_B, CONV_2);
    expect(getLastConversationMap(USER)).toEqual({
      [PROJECT_A]: CONV_1,
      [PROJECT_B]: CONV_2,
    });
  });

  it('updates a single project without affecting others', () => {
    setLastConversation(USER, PROJECT_A, CONV_1);
    setLastConversation(USER, PROJECT_B, CONV_2);
    setLastConversation(USER, PROJECT_A, 'conv-1-updated');
    expect(getLastConversationMap(USER)[PROJECT_A]).toBe('conv-1-updated');
    expect(getLastConversationMap(USER)[PROJECT_B]).toBe(CONV_2);
  });

  it('clears one project entry', () => {
    setLastConversation(USER, PROJECT_A, CONV_1);
    setLastConversation(USER, PROJECT_B, CONV_2);
    clearLastConversation(USER, PROJECT_A);
    expect(getLastConversationMap(USER)).toEqual({ [PROJECT_B]: CONV_2 });
  });

  it('isolates maps by userId', () => {
    setLastConversation(USER, PROJECT_A, CONV_1);
    setLastConversation('other-user', PROJECT_A, CONV_2);
    expect(getLastConversationMap(USER)).toEqual({ [PROJECT_A]: CONV_1 });
    expect(getLastConversationMap('other-user')).toEqual({ [PROJECT_A]: CONV_2 });
  });
});

describe('agentChatStorage autoExecute preference', () => {
  it('defaults to true when not stored', () => {
    expect(getAutoExecutePreference(USER)).toBe(true);
  });

  it('persists false preference', () => {
    setAutoExecutePreference(USER, false);
    expect(getAutoExecutePreference(USER)).toBe(false);
  });

  it('persists true preference', () => {
    setAutoExecutePreference(USER, true);
    expect(getAutoExecutePreference(USER)).toBe(true);
  });
});
