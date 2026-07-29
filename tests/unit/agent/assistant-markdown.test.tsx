import { renderToStaticMarkup } from 'react-dom/server';
import { AssistantMarkdown } from '@/components/agent/AssistantMarkdown';

jest.mock('@/components/agent/ChatPanel.module.css', () => ({
  markdown: 'markdown',
  markdownTableWrap: 'markdownTableWrap',
  markdownTable: 'markdownTable',
  entityChip: 'entityChip',
}));

describe('AssistantMarkdown', () => {
  it('renders strong text and a GFM table', () => {
    const html = renderToStaticMarkup(
      <AssistantMarkdown
        markdown={'**Done**\n\n| Feature | Status |\n| --- | --- |\n| Docs | OK |'}
      />
    );

    expect(html).toContain('<strong class="entityChip">Done</strong>');
    expect(html).toContain('class="markdownTableWrap"');
    expect(html).toContain('<table class="markdownTable">');
    expect(html).toContain('<th>Feature</th>');
    expect(html).toContain('<td>Docs</td>');
  });

  it('renders inline code as entity chips', () => {
    const html = renderToStaticMarkup(
      <AssistantMarkdown markdown={'Changed `General` to `Grand General`'} />
    );

    expect(html).toContain('class="entityChip"');
    expect(html).toContain('General');
    expect(html).toContain('Grand General');
  });

  it('renders strong text as entity chips', () => {
    const html = renderToStaticMarkup(
      <AssistantMarkdown markdown={'Changed **General** to **Grand General**'} />
    );

    expect(html).toContain('<strong class="entityChip">General</strong>');
    expect(html).toContain('<strong class="entityChip">Grand General</strong>');
  });

  it('does not execute raw HTML', () => {
    const html = renderToStaticMarkup(
      <AssistantMarkdown markdown={'<script>alert(1)</script>\n\nSafe'} />
    );

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Safe');
  });

  it('does not render thematic breaks', () => {
    const html = renderToStaticMarkup(
      <AssistantMarkdown markdown={'Hello\n\n---\n\n---\n\n---\n\nWorld'} />
    );

    expect(html).not.toContain('<hr');
    expect(html).toContain('Hello');
    expect(html).toContain('World');
  });

  it('renders nothing for break-only replies', () => {
    const html = renderToStaticMarkup(
      <AssistantMarkdown markdown={'---\n\n---\n***'} />
    );

    expect(html).not.toContain('<hr');
  });
});
