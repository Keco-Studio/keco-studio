/** @jest-environment jsdom */

import { useEffect } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GddMapArtifactView } from '@/lib/documents/gddMapArtifactService';

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const READY_ID = '11111111-1111-4111-8111-111111111111';
const RUNNING_ID = '22222222-2222-4222-8222-222222222222';
const resolveArtifacts = jest.fn();
const supabase = {};

jest.mock('@/lib/SupabaseContext', () => ({
  useSupabase: () => supabase,
}));

jest.mock('@/lib/documents/gddMapArtifactService', () => ({
  resolveGddMapArtifact: (...args: unknown[]) => resolveArtifacts(...args),
}));

import {
  GDD_MAP_ARTIFACT_POLL_INTERVAL_MS,
  GddMapReferenceProvider,
  gddMapArtifactPollingInterval,
  useGddMapReference,
} from './GddMapReferenceProvider';

type ReferenceState = ReturnType<typeof useGddMapReference>;

function artifact(
  artifactId: string,
  status: GddMapArtifactView['status'],
  imageUrl: string | null = null,
): GddMapArtifactView {
  const phase: GddMapArtifactView['phase'] = status === 'queued'
    ? 'planning'
    : status === 'running'
      ? 'polling'
      : status;
  return {
    artifactId,
    title: artifactId,
    status,
    phase,
    mapProjectId: null,
    mapRevisionId: null,
    mapAssetId: null,
    imageUrl,
    width: null,
    height: null,
    error: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function Probe({
  artifactId,
  onState,
}: {
  artifactId: string;
  onState: (artifactId: string, state: ReferenceState) => void;
}) {
  const state = useGddMapReference(artifactId);
  const { register } = state;
  useEffect(() => register(artifactId), [artifactId, register]);
  useEffect(() => onState(artifactId, state), [artifactId, onState, state]);
  return null;
}

describe('GddMapReferenceProvider', () => {
  afterEach(() => {
    cleanup();
    resolveArtifacts.mockReset();
    focusManager.setFocused(undefined);
    jest.useRealTimers();
  });

  it('polls missing and non-terminal artifacts but stops for terminal artifacts', () => {
    expect(gddMapArtifactPollingInterval(undefined))
      .toBe(GDD_MAP_ARTIFACT_POLL_INTERVAL_MS);
    expect(gddMapArtifactPollingInterval(null))
      .toBe(GDD_MAP_ARTIFACT_POLL_INTERVAL_MS);
    expect(gddMapArtifactPollingInterval(artifact('queued', 'queued')))
      .toBe(GDD_MAP_ARTIFACT_POLL_INTERVAL_MS);
    expect(gddMapArtifactPollingInterval(artifact(RUNNING_ID, 'running')))
      .toBe(GDD_MAP_ARTIFACT_POLL_INTERVAL_MS);
    expect(gddMapArtifactPollingInterval(artifact(READY_ID, 'ready'))).toBe(false);
    expect(gddMapArtifactPollingInterval(artifact('failed', 'failed'))).toBe(false);
    expect(gddMapArtifactPollingInterval(artifact('blocked', 'blocked'))).toBe(false);
  });

  it('retries a missing artifact after 15 seconds and stops once it is ready', async () => {
    jest.useFakeTimers();
    resolveArtifacts
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        artifact(RUNNING_ID, 'ready', 'https://signed.test/running.png'),
      );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <GddMapReferenceProvider projectId={PROJECT_ID}>
          <Probe artifactId={RUNNING_ID} onState={() => undefined} />
        </GddMapReferenceProvider>
      </QueryClientProvider>,
    );

    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(resolveArtifacts).toHaveBeenCalledTimes(1);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(GDD_MAP_ARTIFACT_POLL_INTERVAL_MS);
    });
    expect(resolveArtifacts).toHaveBeenCalledTimes(2);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(GDD_MAP_ARTIFACT_POLL_INTERVAL_MS * 2);
    });
    expect(resolveArtifacts).toHaveBeenCalledTimes(2);
    queryClient.clear();
  });

  it('retains a ready image while refreshing an independent running artifact', async () => {
    const refresh = deferred<GddMapArtifactView | null>();
    let runningCalls = 0;
    resolveArtifacts.mockImplementation(
      async (_client: unknown, _projectId: string, artifactId: string) => {
        if (artifactId === READY_ID) {
          return artifact(READY_ID, 'ready', 'https://signed.test/ready.png');
        }
        runningCalls += 1;
        if (runningCalls === 1) return artifact(RUNNING_ID, 'running');
        return refresh.promise;
      },
    );

    const states = new Map<string, ReferenceState>();
    const onState = (artifactId: string, state: ReferenceState) => {
      states.set(artifactId, state);
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <GddMapReferenceProvider projectId={PROJECT_ID}>
          <Probe artifactId={READY_ID} onState={onState} />
          <Probe artifactId={RUNNING_ID} onState={onState} />
        </GddMapReferenceProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(resolveArtifacts).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(states.get(READY_ID)?.artifact?.imageUrl)
      .toBe('https://signed.test/ready.png'));

    await act(async () => {
      void queryClient.invalidateQueries({
        queryKey: ['gdd-map-artifact', PROJECT_ID, RUNNING_ID],
        exact: true,
      });
    });
    await waitFor(() => expect(resolveArtifacts).toHaveBeenCalledTimes(3));

    expect(resolveArtifacts.mock.calls.filter((call) => call[2] === READY_ID)).toHaveLength(1);
    expect(resolveArtifacts.mock.calls.filter((call) => call[2] === RUNNING_ID)).toHaveLength(2);
    expect(states.get(READY_ID)?.artifact?.imageUrl)
      .toBe('https://signed.test/ready.png');
    expect(states.get(READY_ID)?.isLoading).toBe(false);

    await act(async () => {
      refresh.resolve(artifact(RUNNING_ID, 'ready', 'https://signed.test/running.png'));
      await refresh.promise;
    });
    await waitFor(() => expect(states.get(RUNNING_ID)?.artifact?.status).toBe('ready'));

    expect(states.get(READY_ID)?.artifact?.imageUrl)
      .toBe('https://signed.test/ready.png');
    queryClient.clear();
  });

  it('keeps the current image visible while renewing its signed URL', async () => {
    jest.useFakeTimers();
    focusManager.setFocused(false);
    const refresh = deferred<GddMapArtifactView | null>();
    resolveArtifacts
      .mockResolvedValueOnce(artifact(READY_ID, 'ready', 'https://signed.test/first.png'))
      .mockReturnValueOnce(refresh.promise);

    let state: ReferenceState | undefined;
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: Infinity,
          refetchOnMount: false,
          refetchOnWindowFocus: false,
        },
      },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <GddMapReferenceProvider projectId={PROJECT_ID}>
          <Probe artifactId={READY_ID} onState={(_artifactId, next) => { state = next; }} />
        </GddMapReferenceProvider>
      </QueryClientProvider>,
    );

    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(state?.artifact?.imageUrl).toBe('https://signed.test/first.png');

    await act(async () => {
      await jest.advanceTimersByTimeAsync(GDD_MAP_ARTIFACT_POLL_INTERVAL_MS);
      focusManager.setFocused(true);
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(resolveArtifacts).toHaveBeenCalledTimes(2);

    expect(state?.artifact?.imageUrl).toBe('https://signed.test/first.png');
    expect(state?.isLoading).toBe(false);

    await act(async () => {
      refresh.resolve(artifact(READY_ID, 'ready', 'https://signed.test/renewed.png'));
      await refresh.promise;
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(state?.artifact?.imageUrl).toBe('https://signed.test/renewed.png');
    queryClient.clear();
  });
});
