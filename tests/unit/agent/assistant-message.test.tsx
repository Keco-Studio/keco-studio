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

  it('does not render an assistant bubble for break-only text', () => {
    const html = renderToStaticMarkup(
      <ChatMessage
        item={{ id: 'assistant-breaks', role: 'assistant', text: '---\n\n***' }}
        streaming={false}
        onDecision={jest.fn()}
      />
    );

    expect(html).not.toContain('agent-message-assistant');
  });

  it('does not render completed tool cards', () => {
    const html = renderToStaticMarkup(
      <ChatMessage
        item={{
          id: 'tool-query-assets',
          role: 'tool',
          toolCall: { tool: 'query_assets', status: 'success', data: { rows: [] } },
        }}
        streaming={false}
        onDecision={jest.fn()}
      />
    );

    expect(html).toBe('');
  });

  it('does not flash running tool cards', () => {
    const html = renderToStaticMarkup(
      <ChatMessage
        item={{
          id: 'tool-schema-running',
          role: 'tool',
          toolCall: { tool: 'get_library_schema', status: 'running' },
        }}
        streaming
        onDecision={jest.fn()}
      />
    );

    expect(html).toBe('');
  });

  it('does not render failed tool cards', () => {
    const html = renderToStaticMarkup(
      <ChatMessage
        item={{
          id: 'tool-query-failed',
          role: 'tool',
          toolCall: { tool: 'query_assets', status: 'failure', error: 'Query failed' },
        }}
        streaming={false}
        onDecision={jest.fn()}
      />
    );

    expect(html).toBe('');
  });

  it('shows only the completed answer after reasoning', () => {
    const html = renderToStaticMarkup(
      <ChatMessage
        item={{
          id: 'assistant-with-answer',
          role: 'assistant',
          reasoning: 'Check the project.\n\nCreate the assets.',
          reasoningStartedAt: 1_000,
          reasoningEndedAt: 2_000,
          text: '**Done.**',
        }}
        streaming={false}
        onDecision={jest.fn()}
      />
    );

    expect(html).not.toContain('agent-reasoning-answer-divider');
    expect(html).not.toContain('aria-expanded');
    expect(html).not.toContain('Create the assets');
    expect(html).toContain('<strong>Done.</strong>');
  });

  it('shows only the answer while it is streaming', () => {
    const html = renderToStaticMarkup(
      <ChatMessage
        item={{
          id: 'assistant-streaming-answer',
          role: 'assistant',
          reasoning: 'Check the project.',
          reasoningStartedAt: 1_000,
          reasoningEndedAt: 2_000,
          text: 'Writing the answer...',
        }}
        streaming
        onDecision={jest.fn()}
      />
    );

    expect(html).not.toContain('agent-reasoning-answer-divider');
    expect(html).not.toContain('aria-expanded');
    expect(html).not.toContain('Check the project');
    expect(html).toContain('Writing the answer...');
  });
});
