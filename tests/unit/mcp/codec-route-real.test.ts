import { spawnSync } from 'node:child_process';
import path from 'node:path';
import * as Y from 'yjs';
import { decodeBase64 } from '@/lib/documents/documentCollaborationProtocol';

jest.setTimeout(60_000);

const MARKDOWN_FIXTURE = [
  '# <BlockAnchor id="11111111-1111-4111-8111-111111111111" />Shared codec fixture',
  '',
  '<BlockAnchor id="22222222-2222-4222-8222-222222222222" />A paragraph with **bold text** and a [safe link](https://example.com).',
  '',
  '- <BlockAnchor id="33333333-3333-4333-8333-333333333333" />first item',
  '- <BlockAnchor id="44444444-4444-4444-8444-444444444444" />second item',
].join('\n');

function codecProbe(input: Record<string, unknown>): Record<string, unknown> {
  const result = spawnSync(process.execPath, [
    '--import', 'tsx', path.join(process.cwd(), 'tests/helpers/documentCodecProbe.ts'),
  ], {
    cwd: process.cwd(), encoding: 'utf8', input: JSON.stringify(input),
    env: { ...process.env, DOCUMENT_CODEC_COMMONJS: '1' },
  });
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

describe('MCP route and Node codec shared real fixture', () => {
  it('returns decodable Yjs state with Markdown equivalent to the real Node codec', () => {
    const direct = codecProbe({ mode: 'normalize', markdown: MARKDOWN_FIXTURE }) as {
      yjsStateBase64: string;
      markdown: string;
    };
    const result = codecProbe({ mode: 'route-encode', markdown: MARKDOWN_FIXTURE,
      secret: 'real-codec-test-secret' }) as { status: number; body: {
        yjsStateBase64: string; markdown: string;
      } };
    expect(result.status).toBe(200);
    const routed = result.body;

    const yjsDocument = new Y.Doc();
    expect(() => Y.applyUpdate(yjsDocument, decodeBase64(routed.yjsStateBase64))).not.toThrow();
    expect(Y.encodeStateAsUpdate(yjsDocument).byteLength).toBeGreaterThan(0);
    yjsDocument.destroy();

    expect(routed.markdown).toBe(direct.markdown);
    expect(codecProbe({ mode: 'state', snapshot: routed.yjsStateBase64, updates: [] }))
      .toEqual({ markdown: routed.markdown });
  });
});
