import { renderToStaticMarkup } from 'react-dom/server';
import { AssistantMarkdown } from '@/components/agent/AssistantMarkdown';

jest.mock('@/components/agent/ChatPanel.module.css', () => ({
  markdown: 'markdown',
  markdownTableWrap: 'markdownTableWrap',
  markdownTable: 'markdownTable',
}));

describe('AssistantMarkdown', () => {
  it('renders strong text and a GFM table', () => {
    const html = renderToStaticMarkup(
      <AssistantMarkdown
        markdown={'**Done**\n\n| Feature | Status |\n| --- | --- |\n| Docs | OK |'}
      />
    );

    expect(html).toContain('<strong>Done</strong>');
    expect(html).toContain('class="markdownTableWrap"');
    expect(html).toContain('<table class="markdownTable">');
    expect(html).toContain('<th>Feature</th>');
    expect(html).toContain('<td>Docs</td>');
  });

  it('does not execute raw HTML', () => {
    const html = renderToStaticMarkup(
      <AssistantMarkdown markdown={'<script>alert(1)</script>\n\nSafe'} />
    );

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Safe');
  });
});
