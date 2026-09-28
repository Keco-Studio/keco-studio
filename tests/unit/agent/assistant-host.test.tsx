/** @jest-environment jsdom */

import React, { useEffect, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AssistantHost } from '@/components/agent/AssistantHost';
import { LeftNav } from '@/components/layout/LeftNav';
import { agentRuntimeScopeKey, resetAgentChatRuntimeStoreForTests } from '@/components/agent/agentChatRuntimeStore';
import { setLastConversation } from '@/components/agent/agentChatStorage';
import { deriveAgentWorkspaceContext, type AgentNavigationContext } from '@/lib/agent/client-workspace';

const PROJECT = '11111111-1111-4111-8111-111111111111';
let mockPathname = '/projects';
let mockNavigation: AgentNavigationContext;
const mockGetSession = jest.fn(async () => ({ data: { session: { access_token: 'token' } } }));
const mockSupabase = { auth: { getSession: mockGetSession } };

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}));
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

function AssistantShell() {
  const context = deriveAgentWorkspaceContext(mockPathname, mockNavigation, null);
  const scopeKey = context ? `${mockPathname}|${context.workspace}|${context.projectId ?? ''}` : null;
  const [openKey, setOpenKey] = useState<string | null>(null);
  const open = Boolean(scopeKey && openKey === scopeKey);
  useEffect(() => {
    if (openKey && openKey !== scopeKey) setOpenKey(null);
  }, [openKey, scopeKey]);
  const onOpenChange = (next: boolean) => setOpenKey(next ? scopeKey : null);
  return <>
    {context && <LeftNav assistantAvailable assistantOpen={open} onAssistantToggle={() => onOpenChange(!open)} />}
    <AssistantHost context={context} open={open} onOpenChange={onOpenChange} />
  </>;
}

function mountShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><AssistantShell /></QueryClientProvider>;
  const view = render(tree());
  return { ...view, rerenderShell: () => view.rerender(tree()) };
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

describe('Assistant rail', () => {
  it.each(['/projects', `/${PROJECT}/doc/doc-1`, '/script-system',
    `/script-system/${PROJECT}/doc/doc-1`, '/create-map', '/game-design-systems/create'])
  ('renders one rail launcher on %s without loading chat', (path) => {
    mockPathname = path;
    const { container } = mountShell();
    expect(container.querySelectorAll('[data-testid="agent-launcher"]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Keco Assistant' }).getAttribute('aria-pressed')).toBe('false');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it.each(['/simulation-system/battle', '/account', '/billing', '/mcp',
    '/keco-admin', '/keco-101', '/auth/callback', '/accept-invitation',
    '/oauth/consent', '/payment/success'])('renders no launcher on %s', (path) => {
    mockPathname = path;
    const { container } = mountShell();
    expect(container.querySelector('[data-testid="agent-launcher"]')).toBeNull();
    expect(container.querySelector('[data-testid="agent-panel"]')).toBeNull();
  });

  it('opens and closes from the rail, restores history lazily, and closes on navigation', async () => {
    setLastConversation('user-1', agentRuntimeScopeKey({ userId: 'user-1', workspace: 'projects' }), 'conv-1');
    const view = mountShell();
    expect(mockFetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('agent-launcher'));
    expect(screen.getByTestId('agent-panel')).not.toBeNull();
    expect(screen.getByTestId('agent-launcher').getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(
      '/api/agent-chat/conversations/conv-1/messages?limit=200', expect.any(Object)
    ));
    expect(mockGetSession).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('agent-launcher'));
    expect(screen.queryByTestId('agent-panel')).toBeNull();
    fireEvent.click(screen.getByTestId('agent-launcher'));
    expect(screen.getByTestId('agent-panel')).not.toBeNull();
    const requestsAfterOpen = mockFetch.mock.calls.length;

    mockPathname = '/create-map';
    view.rerenderShell();
    expect(screen.queryByTestId('agent-panel')).toBeNull();
    expect(screen.getAllByTestId('agent-launcher')).toHaveLength(1);
    expect(screen.getByTestId('agent-launcher').getAttribute('aria-pressed')).toBe('false');
    expect(mockFetch).toHaveBeenCalledTimes(requestsAfterOpen);
  });
});
