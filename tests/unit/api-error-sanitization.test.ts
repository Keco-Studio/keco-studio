import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/projects/route';
import { createSupabaseServerClient } from '@/lib/createSupabaseServerClient';

jest.mock('@/lib/createSupabaseServerClient', () => ({
  createSupabaseServerClient: jest.fn(),
}));

const createClientMock = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>;

function routeFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = path.join(directory, entry);
    if (statSync(fullPath).isDirectory()) return routeFiles(fullPath);
    return entry === 'route.ts' ? [fullPath] : [];
  });
}

describe('API error sanitization (issue #218)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('never writes an exception or database message directly into an API error response', () => {
    const apiRoot = path.join(process.cwd(), 'src/app/api');
    const leaks = routeFiles(apiRoot).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, index) => ({ file: path.relative(process.cwd(), file), line: index + 1, text: line.trim() }))
        .filter(({ text }) => text.includes('error:') && text.includes('.message'))
    );

    expect(leaks).toEqual([]);
  });

  it.each([
    ['GET', GET, 'Failed to load projects'],
    ['POST', POST, 'Failed to create project'],
  ] as const)('sanitizes raw project database errors for %s', async (method, handler, message) => {
    const rawError = { message: 'column projects.secret_internal does not exist', code: '42703' };
    const query = {
      select: () => query,
      eq: () => query,
      order: async () => ({ data: null, error: rawError }),
    };
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
      from: () => query,
      rpc: async () => ({ data: null, error: rawError }),
    };
    createClientMock.mockReturnValue(client as never);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const request = new NextRequest('https://example.test/api/projects', {
      method,
      ...(method === 'POST'
        ? { body: JSON.stringify({ name: 'Project' }), headers: { 'Content-Type': 'application/json' } }
        : {}),
    });

    const response = await handler(request);

    expect(response.status).toBe(method === 'GET' ? 500 : 400);
    await expect(response.json()).resolves.toEqual({ error: message });
    expect(consoleError).toHaveBeenCalledWith(expect.any(String), rawError);
  });
});
