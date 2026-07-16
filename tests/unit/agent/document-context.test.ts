import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

const resolveDocumentForTool = jest.fn();

jest.mock('@/lib/agent/document-resolver', () => ({ resolveDocumentForTool }));

import { resolveCurrentDocumentContext } from '@/lib/agent/current-document-context';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const supabase = {} as SupabaseClient;

describe('live current-document context', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns only the server-derived id and name for a same-project document', async () => {
    resolveDocumentForTool.mockResolvedValue({
      ok: true,
      source: 'id',
      document: { id: DOCUMENT_ID, name: 'Design Guide' },
    });

    await expect(
      resolveCurrentDocumentContext(supabase, PROJECT_ID, DOCUMENT_ID)
    ).resolves.toEqual({
      currentDocumentId: DOCUMENT_ID,
      currentDocumentName: 'Design Guide',
    });
    expect(resolveDocumentForTool).toHaveBeenCalledWith(
      supabase,
      PROJECT_ID,
      { documentId: DOCUMENT_ID },
      {}
    );
  });

  it('omits an invalid or cross-project document returned as not found', async () => {
    resolveDocumentForTool.mockResolvedValue({
      ok: false,
      code: 'NOT_FOUND',
      error: 'Document was not found in this project.',
    });

    await expect(
      resolveCurrentDocumentContext(supabase, PROJECT_ID, DOCUMENT_ID)
    ).resolves.toEqual({});
  });

  it.each([undefined, '', 'not-a-uuid'])('omits missing or malformed id %p', async (id) => {
    await expect(resolveCurrentDocumentContext(supabase, PROJECT_ID, id)).resolves.toEqual({});
    expect(resolveDocumentForTool).not.toHaveBeenCalled();
  });

  it('wires the live id into both client request branches without changing the frozen key', () => {
    const chatPanel = readFileSync(
      path.join(process.cwd(), 'src/components/agent/ChatPanel.tsx'),
      'utf8'
    );
    const hook = readFileSync(
      path.join(process.cwd(), 'src/components/agent/useAgentChat.ts'),
      'utf8'
    );

    expect(chatPanel).toContain('currentDocumentId,');
    expect(chatPanel).toContain('currentDocumentId: currentDocumentId ?? undefined');
    expect(chatPanel).not.toContain(
      "`${currentProjectId}|${currentFolderId ?? ''}|${currentLibraryId ?? ''}|${currentDocumentId"
    );
    expect(hook.match(/currentDocumentId: ctx\.currentDocumentId/g)).toHaveLength(2);
  });

  it('refreshes the navigation context value when the live document id changes', () => {
    const navigationContext = readFileSync(
      path.join(process.cwd(), 'src/lib/contexts/NavigationContext.tsx'),
      'utf8'
    );
    const valueMemo = navigationContext.match(
      /const value = useMemo<NavigationContextType>\([\s\S]*?\), \[([\s\S]*?)\]\);/
    );

    expect(valueMemo).not.toBeNull();
    expect(valueMemo?.[1]).toMatch(/\bcurrentDocumentId\b/);
  });
});
