import { NextRequest } from 'next/server';

const summarizeLibraryPlotTitles = jest.fn();
const withAuth = jest.fn((handler: unknown) => async (request: NextRequest) => (
  (handler as Function)(request, undefined, {
    supabase: { source: 'test' },
    user: { id: '44444444-4444-4444-8444-444444444444' },
  })
));

jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (handler: unknown) => withAuth(handler),
}));
jest.mock('@/lib/server/scriptPlotTitleService', () => ({
  summarizeLibraryPlotTitles: (...args: unknown[]) => summarizeLibraryPlotTitles(...args),
  mapScriptPlotTitleError: (error: unknown) => ({
    code: 'TITLE_SUMMARY_FAILED',
    status: 502,
    message: error instanceof Error ? error.message : 'Failed to summarize chapter titles',
  }),
}));

import { POST } from './route';

describe('script plot title route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns summarized titles', async () => {
    summarizeLibraryPlotTitles.mockResolvedValueOnce({
      titles: { Talk: '雨中借伞' },
      plotPlan: null,
    });
    const response = await POST(new NextRequest('http://localhost/api/script-plot-titles', {
      method: 'POST',
      body: JSON.stringify({
        projectId: '11111111-1111-4111-8111-111111111111',
        libraryId: '22222222-2222-4222-8222-222222222222',
      }),
    }) as never, undefined as never);
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.titles).toEqual({ Talk: '雨中借伞' });
  });
});
