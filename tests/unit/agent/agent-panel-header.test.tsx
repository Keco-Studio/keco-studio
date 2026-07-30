import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { AgentPanelHeader } from '@/components/agent/AgentPanelHeader';

jest.mock('next/image', () => ({ src, alt, ...props }: { src: string; alt: string; [key: string]: unknown }) =>
  React.createElement('img', { ...props, src, alt })
);
jest.mock('@/assets/images/list.svg', () => 'list.svg', { virtual: true });
jest.mock('@/assets/images/add.svg', () => 'add.svg', { virtual: true });
jest.mock('@/assets/images/close.svg', () => 'close.svg', { virtual: true });
jest.mock('@/components/agent/ChatPanel.module.css', () => ({
  header: 'header',
  headerIdentity: 'headerIdentity',
  headerTitleGroup: 'headerTitleGroup',
  headerTitle: 'headerTitle',
  scopeLock: 'scopeLock',
  headerActions: 'headerActions',
  headerIconButton: 'headerIconButton',
  headerIconButtonActive: 'headerIconButtonActive',
}));

describe('AgentPanelHeader', () => {
  it('renders the Figma-aligned Agent controls with accessible names', () => {
    const html = renderToStaticMarkup(
      <AgentPanelHeader
        canManageConversations
        historyOpen
        subtitle="Locked to skills"
        onNew={() => undefined}
        onHistory={() => undefined}
        onClose={() => undefined}
      />
    );

    expect(html).toContain('Recent chats');
    expect(html).toContain('Locked to skills');
    expect(html).toContain('aria-label="Start new chat"');
    expect(html).toContain('aria-label="Back to chat"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain('aria-label="Close Keco Agent"');
  });

  it('shows the chat title and close control outside history', () => {
    const html = renderToStaticMarkup(
      <AgentPanelHeader
        canManageConversations
        historyOpen={false}
        title="Story planning"
        onNew={() => undefined}
        onHistory={() => undefined}
        onClose={() => undefined}
      />
    );

    expect(html).toContain('Story planning');
    expect(html).toContain('aria-label="Open chat history"');
    expect(html).toContain('aria-label="Close Keco Agent"');
  });

  it('disables conversation actions while unavailable', () => {
    const html = renderToStaticMarkup(
      <AgentPanelHeader
        canManageConversations={false}
        historyOpen={false}
        onNew={() => undefined}
        onHistory={() => undefined}
        onClose={() => undefined}
      />
    );

    expect(html).toContain('New chat');
    expect(html).toContain('aria-label="Close Keco Agent"');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
});
