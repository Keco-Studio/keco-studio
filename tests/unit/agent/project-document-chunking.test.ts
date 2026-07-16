import { chunkProjectDocument } from '@/lib/agent/chunking';

describe('chunkProjectDocument', () => {
  it('chunks Markdown on ATX headings and preserves heading and line ranges', () => {
    const markdown = [
      '# Guide',
      'Opening paragraph.',
      '',
      '## Setup',
      'Install the package.',
      'Then configure it.',
      '',
      '## Usage',
      'Run the command.',
    ].join('\n');

    expect(chunkProjectDocument(markdown)).toEqual([
      {
        chunkIndex: 0,
        content: '# Guide\nOpening paragraph.',
        heading: 'Guide',
        startLine: 1,
        endLine: 2,
      },
      {
        chunkIndex: 1,
        content: '## Setup\nInstall the package.\nThen configure it.',
        heading: 'Setup',
        startLine: 4,
        endLine: 6,
      },
      {
        chunkIndex: 2,
        content: '## Usage\nRun the command.',
        heading: 'Usage',
        startLine: 8,
        endLine: 9,
      },
    ]);
  });

  it('keeps preamble content and ignores blank-only documents', () => {
    expect(chunkProjectDocument('Preamble\n\n# Details\nBody')).toEqual([
      {
        chunkIndex: 0,
        content: 'Preamble',
        startLine: 1,
        endLine: 1,
      },
      {
        chunkIndex: 1,
        content: '# Details\nBody',
        heading: 'Details',
        startLine: 3,
        endLine: 4,
      },
    ]);
    expect(chunkProjectDocument(' \n\n  ')).toEqual([]);
  });

  it('ignores heading-like code lines and preserves non-closing trailing hashes', () => {
    const chunks = chunkProjectDocument(
      '# C#\n```md\n# Not a heading\n```\nBody\n\n  ## Next ##\nDone'
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ heading: 'C#', startLine: 1, endLine: 5 });
    expect(chunks[1]).toMatchObject({ heading: 'Next', startLine: 7, endLine: 8 });
  });
});
