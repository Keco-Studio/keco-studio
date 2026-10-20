import * as uploadContract from '@/lib/services/projectAssetUploadContract';

type FetchCall = { url: string; init?: RequestInit };

describe('uploadProjectAssets', () => {
  it('prepares metadata, uploads bytes to the signed target, and completes the asset registration', async () => {
    const calls: FetchCall[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === '/api/projects/project-1/game-assets') {
        const body = JSON.parse(String(init?.body));
        if (body.action === 'prepare') {
          return new Response(JSON.stringify({
            failedCount: 0,
            items: [{
              index: 0,
              ok: true,
              file: { fileName: 'guide.pdf', fileType: 'application/pdf', fileSize: 8 },
              path: 'user-1/project-1/guide.pdf',
              reservationId: '11111111-1111-4111-8111-111111111111',
              upload: {
                url: 'https://storage.example/upload/guide.pdf',
                method: 'PUT',
                headers: { 'content-type': 'application/pdf' },
              },
            }],
          }), { status: 201 });
        }
        return new Response(JSON.stringify({ completedCount: 1, failedCount: 0, items: [] }), { status: 201 });
      }
      return new Response(null, { status: 200 });
    };
    const file = new File(['%PDF-1.7'], 'guide.pdf', { type: 'application/pdf' });
    const upload = (uploadContract as typeof uploadContract & {
      uploadProjectAssets?: (input: {
        projectId: string;
        files: File[];
        fetcher: typeof fetch;
      }) => Promise<{ completedCount: number; failedCount: number }>;
    }).uploadProjectAssets;

    expect(upload).toBeDefined();
    await expect(upload!({ projectId: 'project-1', files: [file], fetcher })).resolves.toEqual({
      completedCount: 1,
      failedCount: 0,
    });

    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual({
      url: '/api/projects/project-1/game-assets',
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'prepare',
          files: [{ fileName: 'guide.pdf', fileType: 'application/pdf', fileSize: 8 }],
        }),
      },
    });
    expect(calls[1]).toMatchObject({
      url: 'https://storage.example/upload/guide.pdf',
      init: { method: 'PUT', body: file },
    });
    expect(calls[2]).toEqual({
      url: '/api/projects/project-1/game-assets',
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'complete',
          items: [{
            fileName: 'guide.pdf',
            fileType: 'application/pdf',
            fileSize: 8,
            path: 'user-1/project-1/guide.pdf',
            reservationId: '11111111-1111-4111-8111-111111111111',
          }],
        }),
      },
    });
  });

  it('completes a prepared upload after its signed PUT returns an error so the server can release the reservation', async () => {
    const calls: FetchCall[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === '/api/projects/project-1/game-assets') {
        const body = JSON.parse(String(init?.body));
        if (body.action === 'prepare') {
          return new Response(JSON.stringify({
            failedCount: 0,
            items: [{
              index: 0,
              ok: true,
              file: { fileName: 'guide.pdf', fileType: 'application/pdf', fileSize: 8 },
              path: 'user-1/project-1/guide.pdf',
              reservationId: '11111111-1111-4111-8111-111111111111',
              upload: {
                url: 'https://storage.example/upload/guide.pdf',
                method: 'PUT',
                headers: { 'content-type': 'application/pdf' },
              },
            }],
          }), { status: 201 });
        }
        return new Response(JSON.stringify({ completedCount: 0, failedCount: 1, items: [] }), { status: 201 });
      }
      return new Response(null, { status: 500 });
    };
    const file = new File(['%PDF-1.7'], 'guide.pdf', { type: 'application/pdf' });

    await expect(uploadContract.uploadProjectAssets({
      projectId: 'project-1', files: [file], fetcher,
    })).resolves.toEqual({ completedCount: 0, failedCount: 1 });

    expect(calls).toHaveLength(3);
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({
      action: 'complete',
      items: [{
        fileName: 'guide.pdf',
        fileType: 'application/pdf',
        fileSize: 8,
        path: 'user-1/project-1/guide.pdf',
        reservationId: '11111111-1111-4111-8111-111111111111',
      }],
    });
  });
});
