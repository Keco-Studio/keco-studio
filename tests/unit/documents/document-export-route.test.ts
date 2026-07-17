import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { DocumentAccessError, DocumentContentValidationError, DocumentReadOnlyError } from '../../../src/lib/documents/documentStateTypes';

const exportDocument = jest.fn();
const authedSupabase = { source: 'withAuth' };
let authenticated = true;
const withAuth = jest.fn((handler: unknown) => async (
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) => {
  if (!authenticated) {
    return Response.json({ error: 'Please sign in to continue' }, { status: 401 });
  }
  return (handler as (
    request: NextRequest,
    context: { params: Promise<{ documentId: string }> },
    auth: { supabase: object; user: { id: string } }
  ) => Promise<Response>)(request, context, {
    supabase: authedSupabase,
    user: { id: 'user-id' },
  });
});

jest.mock('../../../src/lib/documents/documentExportService', () => ({
  exportDocument: (...args: unknown[]) => exportDocument(...args),
}));
jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (...args: unknown[]) => withAuth(...args),
}));

import { GET, maxDuration } from '../../../src/app/api/documents/[documentId]/export/route';

const editor = fs.readFileSync(
  path.resolve(__dirname, '../../../src/components/documents/DocumentEditor.tsx'),
  'utf8'
);
const nextConfig = fs.readFileSync(
  path.resolve(__dirname, '../../../next.config.mjs'),
  'utf8'
);

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';

function request(format = 'docx'): NextRequest {
  return new NextRequest(`https://example.test/api/documents/${DOCUMENT_ID}/export?format=${format}`);
}

async function get(format = 'docx', documentId = DOCUMENT_ID) {
  return GET(request(format), { params: Promise.resolve({ documentId }) });
}

describe('document export route and UI wiring', () => {
  beforeEach(() => {
    exportDocument.mockReset();
    authenticated = true;
  });

  it('returns explicit binary download headers', async () => {
    exportDocument.mockResolvedValue({
      bytes: Buffer.from('bytes'),
      mediaType: 'application/test',
      fileName: 'project notes.docx',
    });

    const response = await get();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/test');
    expect(response.headers.get('content-disposition')).toContain("filename*=UTF-8''project%20notes.docx");
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(exportDocument).toHaveBeenCalledWith(authedSupabase, DOCUMENT_ID, 'docx');
  });

  it('serves MDX with explicit download headers', async () => {
    exportDocument.mockResolvedValue({
      bytes: Buffer.from('# MDX'),
      mediaType: 'text/markdown; charset=utf-8',
      fileName: 'semantic notes.mdx',
    });

    const response = await get('mdx');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(response.headers.get('content-disposition')).toContain("filename*=UTF-8''semantic%20notes.mdx");
    expect(exportDocument).toHaveBeenCalledWith(authedSupabase, DOCUMENT_ID, 'mdx');
  });

  it('returns 400 for unsupported formats and invalid content', async () => {
    expect((await get('html')).status).toBe(400);
    expect((await get('docx', 'not-a-uuid')).status).toBe(400);
    expect(exportDocument).not.toHaveBeenCalled();

    exportDocument.mockRejectedValue(new DocumentContentValidationError());
    expect((await get()).status).toBe(400);
  });

  it('keeps forbidden and hidden documents distinct from conversion failures', async () => {
    exportDocument.mockRejectedValueOnce(new DocumentReadOnlyError());
    expect((await get()).status).toBe(403);

    exportDocument.mockRejectedValueOnce(new DocumentAccessError());
    expect((await get()).status).toBe(404);

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    exportDocument.mockRejectedValueOnce(new Error('renderer included private details'));
    const response = await get();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Document export failed' });
    expect(errorSpy).toHaveBeenCalledWith(
      '[GET /api/documents/[documentId]/export] Export failed',
      expect.objectContaining({ name: 'Error' })
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('private details');
  });

  it('offers DOCX, PDF, and MDX from one compact download menu', () => {
    expect(editor).toContain('DownloadOutlined');
    expect(editor).toContain("key: 'docx'");
    expect(editor).toContain("key: 'pdf'");
    expect(editor).toContain("key: 'mdx'");
    expect(editor).toContain('Download MDX');
    expect(editor).toContain('data-testid="document-export"');
    expect(nextConfig).toContain("'@mdxeditor/editor'");
  });

  it('uses shared authentication and a 60-second route duration', async () => {
    authenticated = false;

    expect((await get()).status).toBe(401);
    expect(exportDocument).not.toHaveBeenCalled();
    expect(withAuth).toHaveBeenCalledTimes(1);
    expect(maxDuration).toBe(60);
  });
});
