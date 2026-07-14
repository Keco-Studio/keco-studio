import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

type ProbeResult = Record<string, unknown>;

function runCodecProbe(input: Record<string, unknown>): ProbeResult {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      path.join(process.cwd(), 'tests/helpers/documentCodecProbe.ts'),
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      input: JSON.stringify(input),
    }
  );
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout) as ProbeResult;
}

const phaseOneMarkdown = `# Heading

Paragraph with **bold**, _italic_, <u>underline</u>, and \`inline code\`.

1. ordered
2. list

* bullet
* list

Task list:

* [x] checked
* [ ] unchecked

> quoted text

[Keco](https://example.com)

![alt text](https://example.com/image.png "title")

---

\`\`\`ts
const value = 1
\`\`\`

| Name | Value |
| :--- | ---: |
| One | 1 |
`;

describe('document content codec', () => {
  it('round-trips every Phase 1 Markdown node through Lexical Yjs state', async () => {
    const { markdown: restored } = runCodecProbe({
      mode: 'roundtrip',
      markdown: phaseOneMarkdown,
    }) as { markdown: string };

    expect(restored).toContain('# Heading');
    expect(restored).toContain('**bold**');
    expect(restored).toContain('*italic*');
    expect(restored).toContain('<u>underline</u>');
    expect(restored).toContain('`inline code`');
    expect(restored).toMatch(/1\. ordered[\s\S]+2\. list/);
    expect(restored).toMatch(/[*-] bullet/);
    expect(restored).toContain('[x] checked');
    expect(restored).toContain('[ ] unchecked');
    expect(restored).toContain('> quoted text');
    expect(restored).toContain('[Keco](https://example.com)');
    expect(restored).toContain(
      '![alt text](https://example.com/image.png "title")'
    );
    expect(restored).toMatch(/(?:---|\*\*\*)/);
    expect(restored).toContain('```ts');
    expect(restored).toContain('const value = 1');
    expect(restored).toMatch(/\| Name\s+\| Value\s+\|/);
    expect(restored).toMatch(/\| One\s+\|\s+1\s+\|/);
  });

  it.each(['', 'plain text', '# Heading only', '> Quote only']) (
    'round-trips minimal content without DOM globals: %j',
    (markdown) => {
      const { markdown: restored } = runCodecProbe({ mode: 'roundtrip', markdown }) as {
        markdown: string;
      };
      expect(restored.trim()).toBe(markdown.trim());
    }
  );

  it('stores node-level Lexical state in the shared Y.XmlText root', async () => {
    const result = runCodecProbe({ mode: 'structure', markdown: '# Nodes' });
    expect(result.rootType).toBe('YXmlText');
    expect(result.hasMarkdownText).toBe(false);
    expect(result.rootLength).toEqual(expect.any(Number));
    expect(result.rootLength as number).toBeGreaterThan(0);
  });

  it('merges a snapshot and deduplicated concurrent tail updates deterministically', async () => {
    const result = runCodecProbe({ mode: 'merge', markdown: '# Shared' });
    expect(result.equal).toBe(true);
    expect(result.markdown).toContain('# Shared');
  });

  it('rejects malformed Markdown and malformed Yjs state with typed validation errors', async () => {
    const result = runCodecProbe({ mode: 'invalid', markdown: '\u0000', state: 'AQID' });
    expect(result.validateError).toBe('DocumentContentValidationError');
    expect(result.stateError).toBe('DocumentContentValidationError');
  });
});
