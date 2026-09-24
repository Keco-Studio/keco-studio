/** @jest-environment jsdom */
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AssistantHost } from '@/components/agent/AssistantHost';
import { agentRuntimeScopeKey, resetAgentChatRuntimeStoreForTests } from '@/components/agent/agentChatRuntimeStore';
import { setLastConversation } from '@/components/agent/agentChatStorage';
import { compactToolContentForLlm } from '@/lib/agent/tool-result-for-llm';

let mockPathname = '/projects';
const mockNetwork = {
  auth: { getSession: jest.fn(), getUser: jest.fn() },
  from: jest.fn(), rpc: jest.fn(), channel: jest.fn(), storage: { from: jest.fn() },
};
jest.mock('next/navigation', () => ({ usePathname: () => mockPathname, useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));
jest.mock('@/lib/contexts/NavigationContext', () => ({ useNavigation: () => ({ currentProjectId: null }) }));
jest.mock('@/lib/contexts/AuthContext', () => ({ useAuth: () => ({ userProfile: { id: 'performance-user' } }) }));
jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: () => mockNetwork }));
jest.mock('@/lib/agent/conversation-store', () => ({ sanitizeMessagesForLlm: (messages: unknown[]) => messages }));
jest.mock('next/image', () => ({ __esModule: true, default: ({ alt }: { alt: string }) => React.createElement('span', { 'aria-label': alt }) }));

const originalFetch = global.fetch;
const mockFetch = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  resetAgentChatRuntimeStoreForTests();
  global.fetch = mockFetch;
});
afterEach(() => { cleanup(); global.fetch = originalFetch; });

it('keeps closed mounts, existing-history restoration and route changes at zero network work', async () => {
  setLastConversation('performance-user', agentRuntimeScopeKey({ userId: 'performance-user', workspace: 'projects' }), 'existing-conversation');
  const queryClient = new QueryClient();
  const tree = () => <QueryClientProvider client={queryClient}><AssistantHost /></QueryClientProvider>;
  const view = render(tree());
  for (const pathname of ['/projects', '/create-map', '/game-design-systems', '/script-system', '/11111111-1111-4111-8111-111111111111', '/projects']) {
    mockPathname = pathname;
    await act(async () => { view.rerender(tree()); });
    expect(view.queryAllByTestId('agent-launcher')).toHaveLength(1);
    expect(view.queryByTestId('agent-panel')).toBeNull();
  }
  for (const spy of [mockFetch, mockNetwork.auth.getSession, mockNetwork.auth.getUser, mockNetwork.from, mockNetwork.rpc, mockNetwork.channel, mockNetwork.storage.from]) {
    expect(spy).not.toHaveBeenCalled();
  }
  queryClient.clear();
});

it.each(['list_projects', 'list_maps', 'read_map', 'read_game_design_system', 'generate_gdd'])
('preserves the 16,000 character model-result ceiling for %s', (tool) => {
  const raw = JSON.stringify({ success: true, data: { title: 'Large result', records: Array.from({ length: 50 }, (_, id) => ({ id, body: 'Map bounded content '.repeat(1500) })) }, internalData: { secret: 'must-never-reach-model' } });
  const compact = compactToolContentForLlm(raw, tool);
  expect(compact.length).toBeLessThanOrEqual(16_000);
  expect(() => JSON.parse(compact)).not.toThrow();
  expect(compact).not.toContain('must-never-reach-model');
  expect(raw.length).toBeGreaterThan(16_000);
});

it.each(['unstructured '.repeat(2000), JSON.stringify({ success: true, data: '\\"\n'.repeat(10000) })])
('includes the truncation notice within the character budget', (raw) => {
  const compact = compactToolContentForLlm(raw, 'unknown_tool');
  expect(compact.length).toBeLessThanOrEqual(16_000);
  expect(compact).toContain('truncated for LLM context');
  if (raw.startsWith('{')) expect(() => JSON.parse(compact)).not.toThrow();
});
