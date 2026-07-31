import { collapseMarkdownThematicBreaks } from '@/components/agent/collapseMarkdownThematicBreaks';

describe('collapseMarkdownThematicBreaks', () => {
  it('collapses consecutive thematic breaks into one', () => {
    expect(collapseMarkdownThematicBreaks('A\n\n---\n\n---\n\n***\n\nB')).toBe(
      'A\n\n---\n\nB'
    );
  });

  it('strips break-only documents', () => {
    expect(collapseMarkdownThematicBreaks('---\n\n---\n***\n___')).toBe('');
  });

  it('leaves GFM table separator rows alone', () => {
    const table = '| Feature | Status |\n| --- | --- |\n| Docs | OK |';
    expect(collapseMarkdownThematicBreaks(table)).toBe(table);
  });

  it('does not collapse breaks inside fenced code blocks', () => {
    const markdown = 'Intro\n\n```md\n---\n---\n```\n\nOut';
    expect(collapseMarkdownThematicBreaks(markdown)).toBe(markdown);
  });
});
