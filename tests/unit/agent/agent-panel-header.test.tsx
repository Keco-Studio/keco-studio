import { renderToStaticMarkup } from 'react-dom/server';
import { AgentPanelHeader } from '@/components/agent/AgentPanelHeader';

jest.mock('@/components/agent/ChatPanel.module.css', () => ({
  header: 'header',
  headerIdentity: 'headerIdentity',
  agentMark: 'agentMark',
  headerTitleGroup: 'headerTitleGroup',
  headerTitle: 'headerTitle',
  scopeLock: 'scopeLock',
  headerActions: 'headerActions',
  modeToggle: 'modeToggle',
  modeConfirm: 'modeConfirm',
  modeAuto: 'modeAuto',
  headerIconButton: 'headerIconButton',
  headerIconButtonActive: 'headerIconButtonActive',
}));

describe('AgentPanelHeader', () => {
  it('renders the Figma-aligned Agent controls with accessible names', () => {
    const html = renderToStaticMarkup(
      <AgentPanelHeader
        autoExecute={false}
        canManageConversations
        historyOpen
        isStreaming={false}
        scopeLabel="skills"
        scopeLocked
        onToggleMode={() => undefined}
        onNew={() => undefined}
        onHistory={() => undefined}
        onClose={() => undefined}
      />
    );

    expect(html).toContain('Keco Agent');
    expect(html).toContain('Locked to skills');
    expect(html).toContain('Confirm');
    expect(html).toContain('aria-label="Start new chat"');
    expect(html).toContain('aria-label="Open chat history"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Close Keco Agent"');
  });

  it('disables conversation actions and mode switching while unavailable', () => {
    const html = renderToStaticMarkup(
      <AgentPanelHeader
        autoExecute
        canManageConversations={false}
        historyOpen={false}
        isStreaming
        onToggleMode={() => undefined}
        onNew={() => undefined}
        onHistory={() => undefined}
        onClose={() => undefined}
      />
    );

    expect(html).toContain('Auto');
    expect(html.match(/disabled=""/g)).toHaveLength(3);
  });
});
