import { chunkProjectDocument } from '@/lib/agent/chunking';
import { AGENT_PROJECT_DOCUMENT_CHUNK_MAX_CHARS } from '@/lib/agent/embedding-config';

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

  it('hard-splits a huge heading-free line below the provider-safe maximum', () => {
    const markdown = 'word'.repeat(AGENT_PROJECT_DOCUMENT_CHUNK_MAX_CHARS);
    const chunks = chunkProjectDocument(markdown);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.content.length <= AGENT_PROJECT_DOCUMENT_CHUNK_MAX_CHARS)).toBe(true);
    expect(chunks.every((chunk) => chunk.startLine === 1 && chunk.endLine === 1)).toBe(true);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual(
      chunks.map((_chunk, index) => index)
    );
  });

  it('splits a huge heading section at line boundaries and preserves its heading and ranges', () => {
    const bodyLine = 'x'.repeat(Math.floor(AGENT_PROJECT_DOCUMENT_CHUNK_MAX_CHARS / 2));
    const markdown = ['# Large section', bodyLine, bodyLine, bodyLine, bodyLine].join('\n');
    const chunks = chunkProjectDocument(markdown);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.content.length <= AGENT_PROJECT_DOCUMENT_CHUNK_MAX_CHARS)).toBe(true);
    expect(chunks.every((chunk) => chunk.heading === 'Large section')).toBe(true);
    expect(chunks[0].startLine).toBe(1);
    expect(chunks.at(-1)?.endLine).toBe(5);
  });
});
