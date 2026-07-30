import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { ChatMessage } from '@/components/agent/ChatMessage';

jest.mock('next/image', () => ({ src, alt, ...props }: { src: string; alt: string; [key: string]: unknown }) =>
  React.createElement('img', { ...props, src, alt })
);
jest.mock('@/assets/images/action.svg', () => 'action.svg', { virtual: true });
jest.mock('@/assets/images/analyze.svg', () => 'analyze.svg', { virtual: true });
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
    expect(html).toContain('Connecting/thinking/working...');
    expect(html).toContain('agent-thinking-toggle');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('agent-thinking-panel');
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

  it('keeps thinking collapsed after the answer completes', () => {
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

    expect(html).toContain('agent-thinking-toggle');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('agent-thinking-panel');
    expect(html).not.toContain('Create the assets');
    expect(html).toContain('<strong');
    expect(html).toContain('Done.');
  });

  it('hides the thinking status row for history replies without reasoning', () => {
    const html = renderToStaticMarkup(
      <ChatMessage
        item={{
          id: 'assistant-history',
          role: 'assistant',
          text: 'The hero dataset is large and the query results were truncated.',
        }}
        streaming={false}
        onDecision={jest.fn()}
      />
    );

    expect(html).toContain('agent-message-assistant');
    expect(html).not.toContain('agent-thinking-toggle');
    expect(html).not.toContain('Querying...');
    expect(html).not.toContain('Processing...');
    expect(html).not.toContain('agent-thinking-panel');
    expect(html).not.toContain('role="status"');
    expect(html).toContain('The hero dataset is large');
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

    expect(html).toContain('agent-thinking-toggle');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('agent-thinking-panel');
    expect(html).not.toContain('Check the project');
    expect(html).toContain('Writing the answer...');
  });

  it('keeps streaming plan text inside the thinking card until reasoning exists', () => {
    const html = renderToStaticMarkup(
      <ChatMessage
        item={{
          id: 'assistant-streaming-plan',
          role: 'assistant',
          text: '我先读取文档开头，再补充人物设定。',
        }}
        streaming
        onDecision={jest.fn()}
      />
    );

    expect(html).toContain('agent-thinking-panel');
    expect(html).toContain('我先读取文档开头，再补充人物设定。');
    expect(html).toContain('aria-expanded="true"');
    // Plan text should appear once in the thinking card, not also as a reply bubble.
    expect(html.match(/我先读取文档开头，再补充人物设定。/g)).toHaveLength(1);
  });
});
