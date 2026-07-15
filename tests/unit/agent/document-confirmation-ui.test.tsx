import { renderToStaticMarkup } from 'react-dom/server';
import { ChatMessage } from '@/components/agent/ChatMessage';
import type { ChatItem } from '@/components/agent/types';

jest.mock('@/components/agent/ChatPanel.module.css', () => ({}));

describe('Agent document edit confirmation UI', () => {
  it('renders the exact document proposal in ConfirmationCard instead of ScriptPreviewCard', () => {
    const proposedMarkdown = '# Exact proposal\n\nOnly this preview contains this text.';
    const item: ChatItem = {
      id: 'confirmation-1',
      role: 'confirmation',
      confirmation: {
        actionId: 'action-1',
        tool: 'propose_document_edit',
        args: { documentId: '11111111-1111-4111-8111-111111111111' },
        confirmationMode: 'post_preview',
        preview: {
          type: 'document_edit',
          proposedMarkdown,
        },
      },
    };

    const markup = renderToStaticMarkup(
      <ChatMessage item={item} streaming={false} onDecision={jest.fn()} />
    );

    expect(markup).toContain('Confirm: Apply document edit');
    expect(markup).toContain(proposedMarkdown);
    expect(markup).not.toContain('Import preview:');
    expect(markup).not.toContain('Import Directly');
  });
});
