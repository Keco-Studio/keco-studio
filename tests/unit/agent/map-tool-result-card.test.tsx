/** @jest-environment jsdom */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MapToolResultCard, MapGenerationConfirmationCard } from '@/components/agent/MapToolResultCard';
import { ChatMessage } from '@/components/agent/ChatMessage';
import { mapHistoryMessagesToChatItems } from '@/components/agent/historyMessageMapper';
import { invalidateAgentCaches } from '@/components/agent/useAgentChat';
import { createMapAgentRefreshKey } from '@/lib/create-map/agentRefresh';
import { makeValidMapPlanV3 } from '../create-map/fixtures';

jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: jest.fn() }));
jest.mock('next/navigation', () => ({ useRouter: jest.fn() }));
jest.mock('@/components/agent/AssistantMarkdown', () => ({ AssistantMarkdown: () => null }));

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const data = {
  kind: 'map', projectId: id(1), mapId: id(2), revisionId: id(3), revisionNumber: 4, saveVersion: 2,
  plan: { title: 'Mountain village', summary: 'A small map', width: 512, height: 512, referenceCount: 0 },
  generation: { assetId: id(4), status: 'ready', attemptCount: 2, imageUrl: 'https://example.test/map.png?token=signed', lastErrorCode: null },
};

afterEach(cleanup);

describe('shared agent Map cards', () => {
  const withQueryClient = (node: React.ReactNode, queryClient = new QueryClient()) => (
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
  );
  it('renders title, version, status, history summary and a downloadable ready image', () => {
    const markup = renderToStaticMarkup(<MapToolResultCard data={data} />);
    expect(markup).toContain('Mountain village');
    expect(markup).toContain('Version 4');
    expect(markup).toContain('Status: ready');
    expect(markup).toContain('2 attempt(s)');
    expect(markup).toContain('download=""');
    expect(markup).toContain('https://example.test/map.png?token=signed');
    expect(markup).not.toContain('<canvas');
    expect(markup).not.toContain('<textarea');
  });

  it.each([null, [], 'untrusted', { ...data, revisionNumber: '4' }, { ...data, plan: { title: {} } }])('safely rejects malformed payload %#', (value) => {
    expect(renderToStaticMarkup(<MapToolResultCard data={value} />)).toBe('');
  });

  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', '//evil.test/map', 'https://user:password@example.test/map'])('omits unsafe download URL %s', (imageUrl) => {
    const markup = renderToStaticMarkup(<MapToolResultCard data={{ ...data, generation: { ...data.generation, imageUrl } }} />);
    expect(markup).not.toContain('Download map');
  });

  it('offers downloads only for ready assets', () => {
    expect(renderToStaticMarkup(<MapToolResultCard data={{ ...data, generation: { ...data.generation, status: 'generating' } }} />)).not.toContain('Download map');
  });

  it('renders escaped titles and a bounded map list', () => {
    const entry = { mapId: id(2), revisionId: id(3), title: '<script>bad</script>' };
    const list = { kind: 'list', projectId: id(1), maps: [entry], nextCursor: id(2) };
    const markup = renderToStaticMarkup(<MapToolResultCard data={list} />);
    expect(markup).toContain('&lt;script&gt;bad&lt;/script&gt;');
    expect(markup).toContain('More maps are available');
    expect(renderToStaticMarkup(<MapToolResultCard data={{ ...list, maps: Array(51).fill(entry) }} />)).toBe('');
  });

  it('shows map tool results live and after restoring persisted history', () => {
    const item = { id: 'live', role: 'tool' as const, toolCall: { tool: 'read_map', status: 'success' as const, displayHint: 'map', data } };
    expect(renderToStaticMarkup(<ChatMessage item={item} streaming={false} onDecision={jest.fn()} />)).toContain('agent-map-result');
    const history = mapHistoryMessagesToChatItems([{ id: 'old', role: 'tool', content: { name: 'read_map', content: JSON.stringify({ success: true, displayHint: 'map', data }) } }]);
    expect(renderToStaticMarkup(<ChatMessage item={history[0]} streaming={false} onDecision={jest.fn()} />)).toContain('Mountain village');
    expect(renderToStaticMarkup(<ChatMessage item={{ ...item, toolCall: { ...item.toolCall, status: 'failure' } }} streaming={false} onDecision={jest.fn()} />)).toBe('');
  });

  it('restores map cards that follow an assistant tool call', () => {
    const history = mapHistoryMessagesToChatItems([
      { id: 'assistant', role: 'assistant', content: { content: '', tool_calls: [{ id: 'call', function: { name: 'read_map' } }] } },
      { id: 'tool', role: 'tool', content: { name: 'read_map', tool_call_id: 'call', content: JSON.stringify({ success: true, displayHint: 'map', data }) } },
    ]);
    expect(history[0].toolCall).toMatchObject({ displayHint: 'map', data, status: 'success' });
  });

  it('requires a valid exact preview and presents fees before approval', () => {
    const onDecision = jest.fn();
    const confirmation = {
      actionId: 'action', tool: 'retry_map_generation', args: {}, confirmationMode: 'pre_execute' as const,
      preview: { type: 'map_generation', projectId: id(1), mapId: id(2), plan: makeValidMapPlanV3(), saveVersion: 3, feeNotice: 'This is paid.', confirmationPurpose: 'retry', confirmationExpiresAt: '2026-09-24T12:00:00Z', duplicateBillingWarning: 'May charge twice.' },
    };
    render(withQueryClient(<ChatMessage item={{ id: 'confirm', role: 'confirmation', confirmation }} streaming={false} onDecision={onDecision} />));
    expect(screen.getByText('This is paid.')).toBeTruthy();
    expect(screen.getByText('May charge twice.')).toBeTruthy();
    expect(screen.getByText('Exact map plan')).toBeTruthy();
    fireEvent.click(screen.getByText('Confirm paid generation'));
    expect(onDecision).toHaveBeenCalledWith('action', 'approve');
    cleanup();
    render(withQueryClient(<MapGenerationConfirmationCard confirmation={{ ...confirmation, preview: {} }} disabled={false} onDecision={onDecision} />));
    expect(screen.queryByTestId('agent-confirm')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('publishes project-scoped workbench refresh after cache invalidation', async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    const router = { refresh: jest.fn() };
    await invalidateAgentCaches(queryClient, router, [{ type: 'create-map', projectId: id(1), mapId: id(2) }]);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['create-map'] });
    expect(queryClient.getQueryData(createMapAgentRefreshKey)).toEqual({ type: 'create-map', projectId: id(1), mapId: id(2), sequence: 1 });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes the forked draft when preparation completes, even if the user cancels payment', () => {
    const queryClient = new QueryClient();
    const onDecision = jest.fn();
    render(withQueryClient(<MapGenerationConfirmationCard
        confirmation={{
          actionId: 'prepared', tool: 'generate_map_image', args: {}, confirmationMode: 'pre_execute',
          preview: { type: 'map_generation', projectId: id(1), mapId: id(2), nextDraftRevisionId: id(5),
            plan: makeValidMapPlanV3(), saveVersion: 0, feeNotice: 'Paid generation.', confirmationPurpose: 'submit', confirmationExpiresAt: '2026-09-24T12:00:00Z' },
        }}
        disabled={false}
        onDecision={onDecision}
      />, queryClient));
    expect(queryClient.getQueryData(createMapAgentRefreshKey)).toEqual({ projectId: id(1), mapId: id(2), sequence: 1 });
    expect(onDecision).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Cancel'));
    expect(onDecision).toHaveBeenCalledWith('prepared', 'reject');
  });
});
