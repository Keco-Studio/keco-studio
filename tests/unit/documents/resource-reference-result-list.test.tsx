import { act, useState } from 'react';
import type { Root } from 'react-dom/client';

jest.mock('@/components/documents/ResourceReferencePickerModal.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

import { ResourceReferenceResultList } from '@/components/documents/ResourceReferenceResultList';

type Item = { id: string; title: string; description: string };

function createDom() {
  const documentLike: any = {
    nodeType: 9,
    activeElement: null,
    documentElement: { namespaceURI: 'http://www.w3.org/1999/xhtml' },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    defaultView: {
      HTMLIFrameElement: function HTMLIFrameElement() {},
      event: undefined,
    },
  };
  documentLike.defaultView.document = documentLike;

  const createElement = (tagName: string) => {
    const listeners = new Map<string, Set<(event: any) => void>>();
    const element: any = {
      nodeType: 1,
      tagName: tagName.toUpperCase(),
      nodeName: tagName.toUpperCase(),
      namespaceURI: 'http://www.w3.org/1999/xhtml',
      ownerDocument: documentLike,
      parentNode: null,
      childNodes: [],
      attributes: new Map<string, string>(),
      style: {},
      tabIndex: -1,
      textContent: '',
      addEventListener(type: string, listener: (event: any) => void) {
        const registered = listeners.get(type) ?? new Set();
        registered.add(listener);
        listeners.set(type, registered);
      },
      removeEventListener(type: string, listener: (event: any) => void) {
        listeners.get(type)?.delete(listener);
      },
      setAttribute(name: string, value: unknown) {
        element.attributes.set(name, String(value));
        if (name === 'tabindex') element.tabIndex = Number(value);
      },
      getAttribute(name: string) {
        return element.attributes.get(name) ?? null;
      },
      removeAttribute(name: string) {
        element.attributes.delete(name);
      },
      appendChild(child: any) {
        child.parentNode = element;
        element.childNodes.push(child);
        return child;
      },
      insertBefore(child: any, before: any) {
        child.parentNode = element;
        const index = element.childNodes.indexOf(before);
        element.childNodes.splice(index < 0 ? element.childNodes.length : index, 0, child);
        return child;
      },
      removeChild(child: any) {
        const index = element.childNodes.indexOf(child);
        if (index >= 0) element.childNodes.splice(index, 1);
        child.parentNode = null;
        return child;
      },
      focus() {
        documentLike.activeElement = element;
      },
      scrollIntoView: jest.fn(),
      dispatchKey(key: string) {
        const event: any = {
          type: 'keydown',
          key,
          target: element,
          bubbles: true,
          cancelable: true,
          defaultPrevented: false,
          preventDefault() { event.defaultPrevented = true; },
          stopPropagation() { event.cancelBubble = true; },
        };
        let current: any = element;
        while (current) {
          for (const listener of current.__listeners?.get('keydown') ?? []) listener(event);
          if (event.cancelBubble) break;
          current = current.parentNode;
        }
        return event;
      },
      __listeners: listeners,
    };
    return element;
  };
  documentLike.createElement = createElement;
  documentLike.createTextNode = (value: string) => ({
    nodeType: 3,
    nodeValue: value,
    ownerDocument: documentLike,
    parentNode: null,
  });
  return { documentLike, container: createElement('div') };
}

function descendants(node: any): any[] {
  return [node, ...(node.childNodes ?? []).flatMap(descendants)];
}

describe('ResourceReferenceResultList', () => {
  let root: Root;
  let container: any;
  let documentLike: any;
  let originalWindow: typeof globalThis.window | undefined;
  let originalDocument: typeof globalThis.document | undefined;
  const onSelect = jest.fn();
  const initialItems: Item[] = [
    { id: 'a', title: 'Ada', description: 'Archive / Ada' },
    { id: 'b', title: 'Byron', description: 'Archive / Byron' },
    { id: 'c', title: 'Curie', description: 'Archive / Curie' },
  ];

  function Harness({ items = initialItems }: { items?: Item[] }) {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    return (
      <ResourceReferenceResultList
        ariaLabel="Table rows"
        idPrefix="table-reference-row"
        items={items}
        selectedId={selectedId}
        emptyText="No rows"
        getId={(item) => item.id}
        getTitle={(item) => item.title}
        getDescription={(item) => item.description}
        getAriaLabel={(item) => `Row: ${item.title}`}
        onSelect={(item) => {
          setSelectedId(item.id);
          onSelect(item.id);
        }}
      />
    );
  }

  beforeAll(async () => {
    originalWindow = globalThis.window;
    originalDocument = globalThis.document;
    ({ documentLike, container } = createDom());
    Object.assign(globalThis, {
      IS_REACT_ACT_ENVIRONMENT: true,
      window: documentLike.defaultView,
      document: documentLike,
    });
    const { createRoot } = await import('react-dom/client');
    root = createRoot(container as never);
  });

  beforeEach(() => onSelect.mockReset());

  afterAll(async () => {
    await act(async () => root.unmount());
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete (globalThis as { document?: unknown }).document;
    else globalThis.document = originalDocument;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it('keeps focus on the listbox while navigating and selecting its active option', async () => {
    await act(async () => root.render(<Harness />));
    const all = descendants(container);
    const listbox = all.find((node) => node.getAttribute?.('role') === 'listbox');
    const options = all.filter((node) => node.getAttribute?.('role') === 'option');

    expect(listbox.tabIndex).toBe(0);
    expect(options.map((option) => option.tabIndex)).toEqual([-1, -1, -1]);
    listbox.focus();
    expect(documentLike.activeElement).toBe(listbox);

    await act(async () => { expect(listbox.dispatchKey('ArrowDown').defaultPrevented).toBe(true); });
    expect(listbox.getAttribute('aria-activedescendant')).toBe('table-reference-row-b');
    await act(async () => { listbox.dispatchKey('End'); });
    expect(listbox.getAttribute('aria-activedescendant')).toBe('table-reference-row-c');
    await act(async () => { listbox.dispatchKey('Enter'); });
    expect(onSelect).toHaveBeenLastCalledWith('c');
    expect(options[2].getAttribute('aria-selected')).toBe('true');
    expect(documentLike.activeElement).toBe(listbox);

    await act(async () => { listbox.dispatchKey('Home'); });
    await act(async () => { listbox.dispatchKey(' '); });
    expect(onSelect).toHaveBeenLastCalledWith('a');
    expect(options[0].getAttribute('aria-selected')).toBe('true');

    await act(async () => root.render(<Harness items={[initialItems[1]]} />));
    expect(listbox.getAttribute('aria-activedescendant')).toBe('table-reference-row-b');
  });
});
