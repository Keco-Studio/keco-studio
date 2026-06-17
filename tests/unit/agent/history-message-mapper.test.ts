import { mapHistoryMessagesToChatItems } from '../../../src/components/agent/historyMessageMapper';

type HistoryRow = { id: string; role: string; content: Record<string, unknown> };

describe('mapHistoryMessagesToChatItems', () => {
  it('maps user messages to user bubbles', () => {
    const rows: HistoryRow[] = [{ id: 'm1', role: 'user', content: { content: 'Hello' } }];
    const items = mapHistoryMessagesToChatItems(rows);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'm1', role: 'user', text: 'Hello' });
  });

  it('restores image thumbnails from a multimodal user message', () => {
    const rows: HistoryRow[] = [
      {
        id: 'm1b',
        role: 'user',
        content: {
          content: [
            { type: 'text', text: 'look at these' },
            { type: 'image_url', image_url: { url: 'https://x/a.png' } },
            { type: 'image_url', image_url: { url: 'https://x/b.jpg' } },
          ],
        },
      },
    ];
    const items = mapHistoryMessagesToChatItems(rows);
    expect(items).toHaveLength(1);
    expect(items[0].role).toBe('user');
    expect(items[0].text).toBe('look at these');
    expect(items[0].attachments).toEqual([
      { fileName: 'a.png', imageUrl: 'https://x/a.png' },
      { fileName: 'b.jpg', imageUrl: 'https://x/b.jpg' },
    ]);
  });

  it('maps plain assistant text to assistant bubbles', () => {
    const rows: HistoryRow[] = [{ id: 'm2', role: 'assistant', content: { content: 'Hi there' } }];
    const items = mapHistoryMessagesToChatItems(rows);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'm2', role: 'assistant', text: 'Hi there' });
  });

  it('renders tool cards for assistant tool_calls with matching tool rows', () => {
    const rows: HistoryRow[] = [
      {
        id: 'm3',
        role: 'assistant',
        content: {
          content: '',
          tool_calls: [{ id: 'call_1', function: { name: 'query_assets', arguments: '{}' } }],
        },
      },
      {
        id: 'm4',
        role: 'tool',
        content: {
          content: '{"success":true,"count":3}',
          tool_call_id: 'call_1',
          name: 'query_assets',
        },
      },
    ];
    const items = mapHistoryMessagesToChatItems(rows);
    expect(items).toHaveLength(1);
    expect(items[0].role).toBe('tool');
    expect(items[0].toolCall?.tool).toBe('query_assets');
    expect(items[0].toolCall?.status).toBe('success');
  });

  it('skips orphaned tool_calls without tool results', () => {
    const rows: HistoryRow[] = [
      {
        id: 'm5',
        role: 'assistant',
        content: {
          content: '',
          tool_calls: [{ id: 'call_orphan', function: { name: 'delete_asset', arguments: '{}' } }],
        },
      },
      { id: 'm6', role: 'user', content: { content: 'next' } },
    ];
    const items = mapHistoryMessagesToChatItems(rows);
    expect(items).toHaveLength(1);
    expect(items[0].role).toBe('user');
  });

  it('includes assistant text after tool sequence when present', () => {
    const rows: HistoryRow[] = [
      {
        id: 'm7',
        role: 'assistant',
        content: {
          content: 'Thinking…',
          tool_calls: [{ id: 'call_2', function: { name: 'query_assets', arguments: '{}' } }],
        },
      },
      {
        id: 'm8',
        role: 'tool',
        content: { content: '{"ok":true}', tool_call_id: 'call_2', name: 'query_assets' },
      },
      { id: 'm9', role: 'assistant', content: { content: 'Done.' } },
    ];
    const items = mapHistoryMessagesToChatItems(rows);
    expect(items).toHaveLength(3);
    expect(items[0].role).toBe('assistant');
    expect(items[0].text).toBe('Thinking…');
    expect(items[1].role).toBe('tool');
    expect(items[2].role).toBe('assistant');
    expect(items[2].text).toBe('Done.');
  });
});
