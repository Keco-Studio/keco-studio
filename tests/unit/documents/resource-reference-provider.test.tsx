import {
  act,
  useEffect,
  type ReactElement,
  type ReactNode,
} from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Root } from 'react-dom/client';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ResolvedResourceReference } from '@/lib/documents/resourceReferenceService';
import {
  resourceReferenceKey,
  type ResourceReferenceTarget,
} from '@/lib/documents/resourceReferenceTypes';

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TABLE_TARGET: ResourceReferenceTarget = {
  kind: 'table-row',
  libraryId: '11111111-1111-4111-8111-111111111111',
  assetId: '22222222-2222-4222-8222-222222222222',
  displayFieldId: '33333333-3333-4333-8333-333333333333',
  fallbackLabel: 'Ada',
};
const DOCUMENT_TARGET: ResourceReferenceTarget = {
  kind: 'document-block',
  documentId: '44444444-4444-4444-8444-444444444444',
  blockId: '55555555-5555-4555-8555-555555555555',
  blockType: 'paragraph',
  fallbackLabel: 'City gates',
};

type DocumentUpdate = { projectId: string; documentId: string };
type ChannelHarness = {
  handlers: Map<string, () => void>;
  channel: {
    on: jest.Mock;
    subscribe: jest.Mock;
  };
};

const resolveReferences = jest.fn();
const documentUnsubscribe = jest.fn();
let documentListener: ((payload: DocumentUpdate) => void) | undefined;
let supabase: {
  channel: jest.Mock;
  removeChannel: jest.Mock;
};
let channels: Map<string, ChannelHarness>;

jest.mock('@/lib/SupabaseContext', () => ({
  useSupabase: () => supabase,
}));

jest.mock('@/lib/documents/resourceReferenceService', () => ({
  resolveResourceReferences: (...args: unknown[]) => resolveReferences(...args),
}));

jest.mock('@/lib/documents/projectDocumentChannel', () => ({
  subscribeToProjectDocumentUpdates: (
    listener: (payload: DocumentUpdate) => void
  ) => {
    documentListener = listener;
    return documentUnsubscribe;
  },
}));

import {
  ResourceReferenceProvider,
  useResourceReference,
} from '@/components/documents/ResourceReferenceProvider';

type ReferenceState = ReturnType<typeof useResourceReference>;

function resolvedMap(
  targets: readonly ResourceReferenceTarget[],
  suffix = 'resolved'
): Map<string, ResolvedResourceReference> {
  return new Map(
    targets.map((target) => {
      const key = resourceReferenceKey(target);
      return [
        key,
        {
          key,
          status: 'available' as const,
          label: `${target.fallbackLabel} ${suffix}`,
          contextLabel: 'Context',
          href: `/project/reference/${key}`,
        },
      ];
    })
  );
}

function Probe({
  target,
  onState,
}: {
  target: ResourceReferenceTarget;
  onState?: (state: ReferenceState) => void;
}) {
  const state = useResourceReference(target);
  useEffect(() => onState?.(state), [onState, state]);
  return null;
}

function createNullContainer() {
  const documentLike = {
    nodeType: 9,
    activeElement: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    documentElement: { namespaceURI: 'http://www.w3.org/1999/xhtml' },
    defaultView: {
      HTMLIFrameElement: function HTMLIFrameElement() {},
      event: undefined,
    } as Record<string, unknown>,
    createElement: (tagName: string) => ({
      tagName: tagName.toUpperCase(),
      style: {},
      setAttribute: () => undefined,
      removeAttribute: () => undefined,
    }),
  };
  documentLike.defaultView.document = documentLike;
  return {
    documentLike,
    container: {
      nodeType: 1,
      tagName: 'DIV',
      nodeName: 'DIV',
      namespaceURI: 'http://www.w3.org/1999/xhtml',
      ownerDocument: documentLike,
      textContent: '',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      appendChild: () => undefined,
      removeChild: () => undefined,
    },
  };
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (check()) return;
    await settle();
  }
  expect(check()).toBe(true);
}

describe('ResourceReferenceProvider', () => {
  let root: Root;
  let queryClient: QueryClient;
  let renderProvider: (children: ReactNode) => Promise<void>;
  let originalWindow: typeof globalThis.window | undefined;
  let originalDocument: typeof globalThis.document | undefined;

  beforeAll(async () => {
    originalWindow = globalThis.window;
    originalDocument = globalThis.document;
    const { documentLike, container } = createNullContainer();
    Object.assign(globalThis, {
      IS_REACT_ACT_ENVIRONMENT: true,
      window: documentLike.defaultView,
      document: documentLike,
    });
    const { createRoot } = await import('react-dom/client');
    root = createRoot(container as never);
  });

  beforeEach(() => {
    channels = new Map();
    supabase = {
      channel: jest.fn((name: string) => {
        const handlers = new Map<string, () => void>();
        const channel = {
          on: jest.fn(
            (_type: string, filter: { event: string }, handler: () => void) => {
              handlers.set(filter.event, handler);
              return channel;
            }
          ),
          subscribe: jest.fn(() => channel),
        };
        channels.set(name, { channel, handlers });
        return channel;
      }),
      removeChannel: jest.fn(async () => 'ok'),
    };
    resolveReferences.mockReset();
    resolveReferences.mockImplementation(
      async (
        _client: SupabaseClient,
        _projectId: string,
        targets: readonly ResourceReferenceTarget[]
      ) => resolvedMap(targets)
    );
    documentUnsubscribe.mockReset();
    documentListener = undefined;
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    renderProvider = async (children) => {
      await act(async () => {
        root.render(
          <QueryClientProvider client={queryClient}>
            <ResourceReferenceProvider projectId={PROJECT_ID}>
              {children}
            </ResourceReferenceProvider>
          </QueryClientProvider>
        );
      });
      await settle();
    };
  });

  afterEach(async () => {
    await act(async () => root.render(null));
    queryClient.clear();
  });

  afterAll(async () => {
    await act(async () => root.unmount());
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete (globalThis as { document?: unknown }).document;
    else globalThis.document = originalDocument;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it('counts duplicate mounts and resolves one sorted, deduplicated target set', async () => {
    await renderProvider(
      <>
        <Probe target={TABLE_TARGET} />
        <Probe target={{ ...TABLE_TARGET }} />
        <Probe target={DOCUMENT_TARGET} />
      </>
    );
    await waitFor(() => resolveReferences.mock.calls.length === 1);

    expect(resolveReferences).toHaveBeenCalledWith(
      supabase,
      PROJECT_ID,
      [DOCUMENT_TARGET, TABLE_TARGET]
    );
    expect(supabase.channel).toHaveBeenCalledTimes(1);

    await renderProvider(<Probe target={{ ...TABLE_TARGET }} />);
    expect(supabase.removeChannel).not.toHaveBeenCalled();

    await renderProvider(null);
    expect(supabase.removeChannel).toHaveBeenCalledTimes(1);
  });

  it('retains resolved data during a targeted document refetch without a loading flash', async () => {
    let state: ReferenceState | undefined;
    await renderProvider(<Probe target={DOCUMENT_TARGET} onState={(next) => { state = next; }} />);
    await waitFor(() => state?.resolved?.label === 'City gates resolved');

    let resolveRefetch!: (value: Map<string, ResolvedResourceReference>) => void;
    resolveReferences.mockImplementationOnce(
      () => new Promise((resolve) => { resolveRefetch = resolve; })
    );
    await act(async () => {
      documentListener?.({ projectId: PROJECT_ID, documentId: DOCUMENT_TARGET.documentId });
    });
    await waitFor(() => resolveReferences.mock.calls.length === 2);

    expect(state?.resolved?.label).toBe('City gates resolved');
    expect(state?.isLoading).toBe(false);

    await act(async () => resolveRefetch(resolvedMap([DOCUMENT_TARGET], 'updated')));
    await waitFor(() => state?.resolved?.label === 'City gates updated');
  });

  it('invalidates document references only for the currently referenced document', async () => {
    await renderProvider(<Probe target={DOCUMENT_TARGET} />);
    await waitFor(() => resolveReferences.mock.calls.length === 1);

    await act(async () => {
      documentListener?.({ projectId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', documentId: DOCUMENT_TARGET.documentId });
      documentListener?.({ projectId: PROJECT_ID, documentId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' });
    });
    await settle();
    expect(resolveReferences).toHaveBeenCalledTimes(1);

    await act(async () => {
      documentListener?.({ projectId: PROJECT_ID, documentId: DOCUMENT_TARGET.documentId });
    });
    await waitFor(() => resolveReferences.mock.calls.length === 2);
  });

  it.each(['cell:update', 'cells:batch-update', 'asset:delete'])(
    'invalidates table references for %s',
    async (event) => {
      await renderProvider(<Probe target={TABLE_TARGET} />);
      await waitFor(() => resolveReferences.mock.calls.length === 1);
      const channel = channels.get(`library:${TABLE_TARGET.libraryId}:edits`)!;

      await act(async () => channel.handlers.get(event)?.());
      await waitFor(() => resolveReferences.mock.calls.length === 2);
    }
  );

  it('does not churn query or realtime subscriptions for the same semantic set', async () => {
    await renderProvider(<Probe target={TABLE_TARGET} />);
    await waitFor(() => resolveReferences.mock.calls.length === 1);

    await renderProvider(<Probe target={{ ...TABLE_TARGET }} />);

    expect(resolveReferences).toHaveBeenCalledTimes(1);
    expect(supabase.channel).toHaveBeenCalledTimes(1);
    expect(documentUnsubscribe).not.toHaveBeenCalled();
  });

  it('cleans document and library subscriptions on unmount', async () => {
    await renderProvider(
      <>
        <Probe target={TABLE_TARGET} />
        <Probe target={DOCUMENT_TARGET} />
      </>
    );
    await waitFor(() => resolveReferences.mock.calls.length === 1);

    await act(async () => root.render(null));

    expect(documentUnsubscribe).toHaveBeenCalledTimes(1);
    expect(supabase.removeChannel).toHaveBeenCalledTimes(1);
  });
});
