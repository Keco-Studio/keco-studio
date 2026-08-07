/**
 * @jest-environment node
 */

import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';

type FakeEl = {
  textContent: string;
  style: { cssText: string; animation: string };
  parentNode: { removeChild: (node: FakeEl) => void } | null;
  attrs: Record<string, string>;
  setAttribute: (key: string, value: string) => void;
  getAttribute: (key: string) => string | null;
};

const bodyChildren: FakeEl[] = [];

function createEl(): FakeEl {
  const el: FakeEl = {
    textContent: '',
    style: { cssText: '', animation: '' },
    parentNode: null,
    attrs: {},
    setAttribute(key, value) {
      el.attrs[key] = value;
    },
    getAttribute(key) {
      return el.attrs[key] ?? null;
    },
  };
  return el;
}

const fakeDocument = {
  head: { appendChild: () => undefined },
  body: {
    appendChild(node: FakeEl) {
      node.parentNode = {
        removeChild(child: FakeEl) {
          const index = bodyChildren.indexOf(child);
          if (index >= 0) bodyChildren.splice(index, 1);
          child.parentNode = null;
        },
      };
      bodyChildren.push(node);
    },
  },
  createElement(_tag: string) {
    return createEl();
  },
};

describe('showToast sticky remount guard', () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;

  beforeEach(() => {
    bodyChildren.length = 0;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: originalWindow ?? { setTimeout, clearTimeout },
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      writable: true,
      value: fakeDocument,
    });
    jest.resetModules();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: originalWindow,
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      writable: true,
      value: originalDocument,
    });
  });

  it('does not remount an identical sticky toast', async () => {
    const { showToast, dismissToast } = await import('@/lib/utils/toast');
    showToast({
      message: 'Generating…',
      type: 'info',
      duration: 0,
      testId: 'document-derived-import-progress',
    });
    expect(bodyChildren).toHaveLength(1);
    const first = bodyChildren[0];

    showToast({
      message: 'Generating…',
      type: 'info',
      duration: 0,
      testId: 'document-derived-import-progress',
    });

    expect(bodyChildren).toHaveLength(1);
    expect(bodyChildren[0]).toBe(first);
    dismissToast();
  });

  it('still replaces a sticky toast when the message changes', async () => {
    const { showToast, dismissToast } = await import('@/lib/utils/toast');
    showToast({
      message: 'Generating…',
      type: 'info',
      duration: 0,
      testId: 'document-derived-import-progress',
    });
    showToast({
      message: 'Generation failed.',
      type: 'error',
      duration: 8000,
      testId: 'document-derived-import-progress',
    });

    expect(bodyChildren).toHaveLength(1);
    expect(bodyChildren[0]?.textContent).toBe('Generation failed.');
    dismissToast();
  });
});
