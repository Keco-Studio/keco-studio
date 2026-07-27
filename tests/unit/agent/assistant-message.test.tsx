import { renderToStaticMarkup } from 'react-dom/server';
import { ChatMessage } from '@/components/agent/ChatMessage';

jest.mock('@/components/agent/ChatPanel.module.css', () => ({}));

describe('assistant reasoning message', () => {
  it('shows a live summary and thinking state on the collapsed control', () => {
    const html = renderToStaticMarkup(
      <ChatMessage
        item={{
          id: 'assistant-1',
          role: 'assistant',
          reasoning: 'First check the project.\n\nSummarizing results.',
          reasoningStartedAt: Date.now() - 2_000,
        }}
        streaming
        onDecision={jest.fn()}
      />
    );

    expect(html).toContain('Summarizing results');
    expect(html).toContain('(Thinking)');
    expect(html).toContain('aria-expanded="false"');
    expect(html.match(/agent-message-assistant/g)).toHaveLength(1);
  });
});
