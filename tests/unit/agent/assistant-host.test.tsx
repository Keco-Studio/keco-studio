/** @jest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AssistantHost } from '@/components/agent/AssistantHost';
import { agentRuntimeScopeKey, resetAgentChatRuntimeStoreForTests } from '@/components/agent/agentChatRuntimeStore';
import { setLastConversation } from '@/components/agent/agentChatStorage';
import type { AgentNavigationContext } from '@/lib/agent/client-workspace';

const PROJECT = '11111111-1111-4111-8111-111111111111';
let mockPathname = '/projects';
let mockNavigation: AgentNavigationContext;
const mockGetSession = jest.fn(async () => ({ data: { session: { access_token: 'token' } } }));
const mockSupabase = { auth: { getSession: mockGetSession } };

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}));
jest.mock('@/lib/contexts/NavigationContext', () => ({ useNavigation: () => mockNavigation }));
jest.mock('@/lib/contexts/AuthContext', () => ({
  useAuth: () => ({ userProfile: { id: 'user-1' } }),
}));
jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: () => mockSupabase }));
jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt, ...props }: { src: string | { src: string }; alt: string }) =>
    React.createElement('img', { ...props, src: typeof src === 'string' ? src : src.src, alt }),
}));

const mockFetch = jest.fn(async (input: RequestInfo | URL) => ({
  ok: true,
  status: 200,
  json: async () => String(input).endsWith('/meta')
    ? { meta: { autoExecute: false } }
    : { messages: [] },
}));

function mountHost() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><AssistantHost /></QueryClientProvider>);
}

beforeEach(() => {
  mockPathname = '/projects';
  mockNavigation = {
    currentProjectId: null, currentProjectName: null, currentDocumentId: null,
    currentFolderId: null, currentFolderName: null,
    currentLibraryId: null, currentLibraryName: null,
  };
  window.localStorage.clear();
  resetAgentChatRuntimeStoreForTests();
  mockGetSession.mockClear();
  mockFetch.mockClear();
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(cleanup);

describe('AssistantHost', () => {
  it.each(['/projects', `/${PROJECT}/doc/doc-1`, '/script-system',
    `/script-system/${PROJECT}/doc/doc-1`, '/create-map', '/game-design-systems/create'])
  ('renders one collapsed launcher on %s', (path) => {
    mockPathname = path;
    const { container } = mountHost();
    expect(container.querySelectorAll('[data-testid="agent-launcher"]')).toHaveLength(1);
    expect(container.querySelector('[title="Keco Assistant"]')).not.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it.each(['/simulation-system/battle', '/account', '/billing', '/mcp',
    '/keco-admin', '/keco-101', '/auth/callback', '/accept-invitation',
    '/oauth/consent', '/payment/success'])('renders no launcher on %s', (path) => {
    mockPathname = path;
    const { container } = mountHost();
    expect(container.querySelector('[data-testid="agent-launcher"]')).toBeNull();
  });

  it('restores history only after opening and closes on workspace navigation', async () => {
    setLastConversation('user-1', agentRuntimeScopeKey({ userId: 'user-1', workspace: 'projects' }), 'conv-1');
    const view = mountHost();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockGetSession).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('agent-launcher'));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(
      '/api/agent-chat/conversations/conv-1/messages?limit=200', expect.any(Object)
    ));
    expect(mockGetSession).toHaveBeenCalled();
    const requestsAfterOpen = mockFetch.mock.calls.length;

    mockPathname = '/create-map';
    view.rerender(<QueryClientProvider client={new QueryClient()}><AssistantHost /></QueryClientProvider>);
    expect(screen.queryByTestId('agent-panel')).toBeNull();
    expect(screen.getAllByTestId('agent-launcher')).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(requestsAfterOpen);
  });
});
