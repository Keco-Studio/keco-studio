import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { applyDocumentEditOperation } from '@/lib/agent/document-edit-operations';

type ProbeResult = Record<string, unknown>;

const BLOCK_ANCHOR_PATTERN =
  /<BlockAnchor id="([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})" \/>/gi;

function blockAnchorIds(markdown: string): string[] {
  return Array.from(markdown.matchAll(BLOCK_ANCHOR_PATTERN), (match) => match[1]);
}

function withoutBlockAnchors(markdown: string): string {
  return markdown.replace(BLOCK_ANCHOR_PATTERN, '');
}

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
      env: {
        ...process.env,
        DOCUMENT_CODEC_COMMONJS: '1',
      },
      input: JSON.stringify(input),
    }
  );
  expect({ status: result.status, stderr: result.stderr }).toEqual({
    status: 0,
    stderr: '',
  });
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

const decoratorMarkdown = `| Name | Value |
| --- | ---: |
| One | 1 |

\`\`\`ts
const value = 1
\`\`\`

<Callout type="note" title="Heads up">

Nested **Markdown**.

</Callout>`;

describe('document content codec', () => {
  it('normalizes fresh block identities after an Agent replace_all operation', () => {
    const oldHeadingId = '11111111-1111-4111-8111-111111111111';
    const oldParagraphId = '22222222-2222-4222-8222-222222222222';
    const reference = '<ResourceReference kind="document-block" documentId="33333333-3333-4333-8333-333333333333" blockId="44444444-4444-4444-8444-444444444444" blockType="paragraph" fallbackLabel="Original" />';
    const current = `# <BlockAnchor id="${oldHeadingId}" />Old heading\n\n<BlockAnchor id="${oldParagraphId}" />Old body ${reference}`;
    const replacement = applyDocumentEditOperation(current, {
      type: 'replace_all',
      markdown: '# New heading\n\nNew body',
    });

    const { markdown } = runCodecProbe({
      mode: 'roundtrip',
      markdown: replacement,
    }) as { markdown: string };
    const ids = blockAnchorIds(markdown);

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toContain(oldHeadingId);
    expect(ids).not.toContain(oldParagraphId);
    expect(markdown).not.toContain('ResourceReference');
    expect(withoutBlockAnchors(markdown)).toContain('# New heading');
    expect(withoutBlockAnchors(markdown)).toContain('New body');
  });

  it('assigns distinct block anchors and preserves them on the next round trip', () => {
    const { markdown: first } = runCodecProbe({
      mode: 'roundtrip',
      markdown: '# Heading\n\nParagraph',
    }) as { markdown: string };
    const firstIds = blockAnchorIds(first);

    expect(firstIds).toHaveLength(2);
    expect(new Set(firstIds).size).toBe(2);

    const { markdown: second } = runCodecProbe({
      mode: 'roundtrip',
      markdown: first,
    }) as { markdown: string };
    expect(blockAnchorIds(second)).toEqual(firstIds);
  });

  it('exposes list items and quoted paragraphs as selectable reference blocks', () => {
    const result = runCodecProbe({
      mode: 'normalize',
      markdown: '- bug one\n- bug two\n\n> quoted feedback',
    }) as {
      blocks: Array<{ blockType: string; text: string }>;
    };

    expect(result.blocks.map(({ blockType, text }) => ({ blockType, text }))).toEqual([
      { blockType: 'paragraph', text: 'bug one' },
      { blockType: 'paragraph', text: 'bug two' },
      { blockType: 'paragraph', text: 'quoted feedback' },
    ]);
  });

  it('keeps the first duplicate block anchor and regenerates the later one', () => {
    const duplicateId = '11111111-1111-4111-8111-111111111111';
    const { markdown } = runCodecProbe({
      mode: 'roundtrip',
      markdown: `# <BlockAnchor id="${duplicateId}" />Heading\n\n<BlockAnchor id="${duplicateId}" />Paragraph`,
    }) as { markdown: string };
    const ids = blockAnchorIds(markdown);

    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(duplicateId);
    expect(ids[1]).not.toBe(duplicateId);
  });

  it('preserves the identity of an explicitly anchored empty heading', () => {
    const blockId = '22222222-2222-4222-8222-222222222222';
    const { markdown } = runCodecProbe({
      mode: 'roundtrip',
      markdown: `# <BlockAnchor id="${blockId}" />`,
    }) as { markdown: string };

    expect(blockAnchorIds(markdown)).toEqual([blockId]);
  });

  it('round-trips an identified empty paragraph in valid MDX text context', () => {
    const blockId = '44444444-4444-4444-8444-444444444444';
    const source = `<BlockAnchor id="${blockId}" />&#x20;`;
    const { markdown: first } = runCodecProbe({
      mode: 'roundtrip',
      markdown: source,
    }) as { markdown: string };
    const { markdown: second } = runCodecProbe({
      mode: 'roundtrip',
      markdown: first,
    }) as { markdown: string };

    expect(first).toContain('&#x20;');
    expect(blockAnchorIds(first)).toEqual([blockId]);
    expect(blockAnchorIds(second)).toEqual([blockId]);
    expect(
      withoutBlockAnchors(second).replaceAll('&#x20;', '').trim()
    ).toBe('');
  });

  it('round-trips every Phase 1 Markdown node through Lexical Yjs state', async () => {
    const { markdown: restored } = runCodecProbe({
      mode: 'roundtrip',
      markdown: phaseOneMarkdown,
    }) as { markdown: string };
    const semanticMarkdown = withoutBlockAnchors(restored);

    expect(semanticMarkdown).toContain('# Heading');
    expect(semanticMarkdown).toContain('**bold**');
    expect(semanticMarkdown).toContain('*italic*');
    expect(semanticMarkdown).toContain('<u>underline</u>');
    expect(semanticMarkdown).toContain('`inline code`');
    expect(semanticMarkdown).toMatch(/1\. ordered[\s\S]+2\. list/);
    expect(semanticMarkdown).toMatch(/[*-] bullet/);
    expect(semanticMarkdown).toContain('[x] checked');
    expect(semanticMarkdown).toContain('[ ] unchecked');
    expect(semanticMarkdown).toContain('> quoted text');
    expect(semanticMarkdown).toContain('[Keco](https://example.com)');
    expect(semanticMarkdown).toContain(
      '![alt text](https://example.com/image.png "title")'
    );
    expect(semanticMarkdown).toMatch(/(?:---|\*\*\*)/);
    expect(semanticMarkdown).toContain('```ts');
    expect(semanticMarkdown).toContain('const value = 1');
    expect(semanticMarkdown).toMatch(/\| Name\s+\| Value\s+\|/);
    expect(semanticMarkdown).toMatch(/\| One\s+\|\s+1\s+\|/);
  });

  it.each(['', 'plain text', '# Heading only', '> Quote only']) (
    'round-trips minimal content without DOM globals: %j',
    (markdown) => {
      const { markdown: restored } = runCodecProbe({ mode: 'roundtrip', markdown }) as {
        markdown: string;
      };
      expect(withoutBlockAnchors(restored).trim()).toBe(markdown.trim());
    }
  );

  it('stores node-level Lexical state in the shared Y.XmlText root', async () => {
    const result = runCodecProbe({ mode: 'structure', markdown: '# Nodes' });
    expect(result.rootType).toBe('YXmlText');
    expect(result.hasMarkdownText).toBe(false);
    expect(result.rootLength).toEqual(expect.any(Number));
    expect(result.rootLength as number).toBeGreaterThan(0);
  });

  it('keeps decorator emitters out of Yjs and preserves runtime emitters when legacy attributes are hydrated', () => {
    const result = runCodecProbe({
      mode: 'decorators',
      markdown: decoratorMarkdown,
    }) as {
      decoratorAttributes: Array<{ type: string; attributes: string[] }>;
      runtimeEmitters: Array<{
        type: string;
        publish: string;
        subscribe: string;
      }>;
    };

    expect(result.decoratorAttributes.map(({ type }) => type).sort()).toEqual([
      'codeblock',
      'jsx',
      'table',
    ]);
    expect(result.runtimeEmitters).toEqual([
      { type: 'table', publish: 'function', subscribe: 'function' },
      { type: 'codeblock', publish: 'function', subscribe: 'function' },
      { type: 'jsx', publish: 'function', subscribe: 'function' },
    ]);
    for (const { attributes } of result.decoratorAttributes) {
      expect(attributes).not.toContain('focusEmitter');
      expect(attributes).not.toContain('__focusEmitter');
    }
  });

  it('round-trips sanctioned MDX components without evaluating them', () => {
    const source = `<Callout type="note" title="Heads up">\n\nNested **Markdown**.\n\n</Callout>\n\n<Details summary="More">\n\nAdditional content.\n\n</Details>`;
    const { markdown: restored } = runCodecProbe({
      mode: 'roundtrip',
      markdown: source,
    }) as { markdown: string };

    expect(restored).toContain('<Callout type="note" title="Heads up">');
    expect(restored).toContain('Nested **Markdown**.');
    expect(restored).toContain('<Details summary="More">');
    expect(restored).toContain('Additional content.');
  });

  it('merges a snapshot and deduplicated concurrent tail updates deterministically', async () => {
    const result = runCodecProbe({ mode: 'merge', markdown: '# Shared' });
    expect(result.equal).toBe(true);
    expect(withoutBlockAnchors(result.markdown as string)).toContain('# Shared');
  });

  it('returns one minimal durable block-id update for legacy Yjs state', () => {
    const result = runCodecProbe({
      mode: 'normalize-blocks',
      markdown: '# Legacy heading\n\nLegacy paragraph',
    }) as {
      first: {
        yjsStateBase64: string;
        markdown: string;
        normalizationUpdateBase64: string | null;
        blocks: Array<{
          blockId: string;
          blockType: string;
          text: string;
          headingLevel?: number;
          nearestHeading?: string;
        }>;
      };
      second: {
        yjsStateBase64: string;
        markdown: string;
        normalizationUpdateBase64: string | null;
        blocks: Array<{
          blockId: string;
          blockType: string;
          text: string;
          headingLevel?: number;
          nearestHeading?: string;
        }>;
      };
      historicalDeleteRanges: Array<{
        client: number;
        clock: number;
        length: number;
      }>;
      repeatedHistoricalDeleteRanges: Array<{
        client: number;
        clock: number;
        length: number;
      }>;
      deltaAppliedState: string;
    };

    expect(result.first.normalizationUpdateBase64).toEqual(expect.any(String));
    expect(result.first.normalizationUpdateBase64).not.toBe('');
    expect(result.first.blocks).toEqual([
      {
        blockId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        ),
        blockType: 'heading',
        text: 'Legacy heading',
        headingLevel: 1,
      },
      {
        blockId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        ),
        blockType: 'paragraph',
        text: 'Legacy paragraph',
        nearestHeading: 'Legacy heading',
      },
    ]);
    expect(result.deltaAppliedState).toBe(result.first.yjsStateBase64);
    expect(result.second.normalizationUpdateBase64).toBeNull();
    expect(result.second.blocks).toEqual(result.first.blocks);
    expect(result.second.markdown).toBe(result.first.markdown);
    expect(result.second.yjsStateBase64).toBe(result.first.yjsStateBase64);
    expect(result.historicalDeleteRanges.length).toBeGreaterThan(0);
    expect(result.repeatedHistoricalDeleteRanges).toEqual([]);
    expect(blockAnchorIds(result.first.markdown)).toEqual(
      result.first.blocks.map(({ blockId }) => blockId)
    );
  });

  it('preserves a captured delete-only Yjs update', () => {
    const result = runCodecProbe({ mode: 'capture-delete-only' }) as {
      capturedBase64: string | null;
      structCount: number | null;
      deleteRanges: Array<unknown>;
      replicaText: string;
      stateVectorsEqual: boolean;
    };

    expect(result.capturedBase64).toEqual(expect.any(String));
    expect(result.structCount).toBe(0);
    expect(result.deleteRanges.length).toBeGreaterThan(0);
    expect(result.replicaText).toBe('');
    expect(result.stateVectorsEqual).toBe(true);
  });

  it.each([
    ['markdown-listener', 0],
    ['normalize-observer', 1],
  ] as const)(
    'cleans Yjs resources when %s setup throws',
    (target, expectedUnobserveCount) => {
      const result = runCodecProbe({ mode: 'cleanup', target }) as {
        errorName: string;
        docDestroyCount: number;
        awarenessDestroyCount: number;
        bindingDestroyCount: number;
        unobserveDeepCount: number;
      };

      expect(result.errorName).toBe('DocumentContentValidationError');
      expect(result.docDestroyCount).toBe(1);
      expect(result.awarenessDestroyCount).toBe(2);
      expect(result.bindingDestroyCount).toBe(1);
      expect(result.unobserveDeepCount).toBe(expectedUnobserveCount);
    }
  );

  it('rejects malformed Markdown and malformed Yjs state with typed validation errors', async () => {
    const result = runCodecProbe({ mode: 'invalid', markdown: '\u0000', state: 'AQID' });
    expect(result.validateError).toBe('DocumentContentValidationError');
    expect(result.stateError).toBe('DocumentContentValidationError');
  });

  it.each(['Callout', 'Unknown'] as const)(
    'rejects crafted Yjs containing invalid %s JSX with a typed validation error',
    (component) => {
      const result = runCodecProbe({
        mode: 'crafted-invalid-jsx',
        component,
      });

      expect(result.errorName).toBe('DocumentContentValidationError');
    }
  );
});
