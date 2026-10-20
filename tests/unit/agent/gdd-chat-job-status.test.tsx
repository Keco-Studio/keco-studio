/** @jest-environment jsdom */
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { GddChatJobStatus, gddChatJobHasPendingWork } from '@/components/agent/GddChatJobStatus';

jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) } }) }));

const jobId = '10000000-0000-4000-8000-000000000005';
const projectId = '10000000-0000-4000-8000-000000000001';
const documentId = '10000000-0000-4000-8000-000000000090';
const initial = { jobType: 'gdd', jobId, status: 'queued', phase: 'collecting' };

function wrapper(children: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

it('keeps polling through parent completion until resources and maps finish', async () => {
  const responses = [
    { ...initial, status: 'running', phase: 'planning' },
    { ...initial, status: 'completed', phase: 'completed', document: { id: documentId, name: 'Tactics GDD', url: `/${projectId}/doc/${documentId}` },
      resources: [{ kind: 'tables', status: 'queued' }], maps: [] },
    { ...initial, status: 'completed', phase: 'completed', document: { id: documentId, name: 'Tactics GDD', url: `/${projectId}/doc/${documentId}` },
      resources: [{ kind: 'tables', status: 'completed' }], maps: [] },
  ];
  const fetchMock = jest.fn(async () => ({
    ok: true, json: async () => ({ job: responses.shift() ?? responses.at(-1) }),
  }) as Response);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    render(wrapper(<GddChatJobStatus initial={initial} />));
    await waitFor(() => expect(screen.getByTestId('generation-job-status').textContent).toContain('planning'));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 3_100)); });
    await waitFor(() => expect(screen.getByRole('link', { name: 'Tactics GDD' }).getAttribute('href')).toBe(`/${projectId}/doc/${documentId}`));
    expect(screen.getByTestId('generation-job-status').textContent).toContain('tables: queued');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 3_100)); });
    await waitFor(() => expect(screen.getByTestId('generation-job-status').textContent).toContain('tables: completed'));
    const callsAfterCompletion = fetchMock.mock.calls.length;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 3_100)); });
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterCompletion);
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 15_000);

it('treats unknown child status as pending and stops on a failed parent', () => {
  expect(gddChatJobHasPendingWork({ ...initial, status: 'completed', resources: null, maps: [] })).toBe(true);
  expect(gddChatJobHasPendingWork({ ...initial, status: 'failed', error: 'Generation failed.' })).toBe(false);
  const markup = render(wrapper(<GddChatJobStatus initial={{ ...initial, status: 'failed', error: 'Generation failed.' }} />));
  expect(markup.getByTestId('generation-job-status').textContent).toContain('Generation failed.');
});

it('retries a transient status error and still delivers the document', async () => {
  const fetchMock = jest.fn()
    .mockRejectedValueOnce(new Error('temporary network failure'))
    .mockResolvedValue({ ok: true, json: async () => ({ job: {
      ...initial, status: 'completed', phase: 'completed',
      document: { id: documentId, name: 'Recovered GDD', url: `/${projectId}/doc/${documentId}` },
      resources: [], maps: [],
    } }) } as Response);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    render(wrapper(<GddChatJobStatus initial={initial} />));
    await waitFor(() => expect(screen.getByTestId('generation-job-status').textContent).toContain('Status unavailable'));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 3_100)); });
    await waitFor(() => expect(screen.getByRole('link', { name: 'Recovered GDD' })).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 8_000);
