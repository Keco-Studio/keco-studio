import { describe, expect, it, jest } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  inventoryGeneratedPng,
  pythonPixelArtSource,
  redactEvidence,
  runAcceptance,
  type AcceptanceAdmin,
  type PythonRunner,
} from '../../../scripts/accept-python-generated-asset-writeback';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const ASSET_ID = '22222222-2222-4222-8222-222222222222';
const OBJECT_PATH = `33333333-3333-4333-8333-333333333333/${PROJECT_ID}/python-campus.png`;
const SHA256 = '8cae20a8288f46ba7a531c0568a1f7547933433adfebbe955b7877bf80b0a5b9';
const MCP_URL = 'https://mcp.example.test/functions/v1/mcp';
const UPLOAD_URL = 'https://storage.example.test/upload?token=signed-secret';
const ACCEPTANCE_USER_ID = OBJECT_PATH.slice(0, OBJECT_PATH.indexOf('/'));

// A complete IHDR-shaped fixture is sufficient because upload and metadata inspection are external here.
const GENERATED_PNG = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10,
  0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 128, 0, 0, 0, 128,
  8, 6, 0, 0, 0, 1, 2, 3, 4,
]);

function rpcResult(id: number, result: Record<string, unknown>): Response {
  return Response.json({ jsonrpc: '2.0', id, result });
}

function toolResult(id: number, structuredContent: Record<string, unknown>): Response {
  return rpcResult(id, { structuredContent });
}

function preparedFlowResponse(
  message: { id: number; method: string; params?: { name?: string } },
  uploadMethod = 'PUT',
): Response | undefined {
  if (message.method === 'initialize') {
    return rpcResult(message.id, { capabilities: { tools: {} } });
  }
  if (message.method === 'tools/list') {
    return rpcResult(message.id, { tools: [
      { name: 'list_projects' },
      { name: 'prepare_image_uploads' },
      { name: 'complete_project_game_asset_uploads' },
    ] });
  }
  if (message.params?.name === 'list_projects') {
    return toolResult(message.id, {
      ok: true,
      returnedCount: 1,
      items: [{
        projectId: PROJECT_ID,
        name: 'Acceptance project',
        createdAt: '2026-09-10T00:00:00.000Z',
        role: 'editor',
        capabilities: { read: true, create: true, update: true },
      }],
    });
  }
  if (message.params?.name === 'prepare_image_uploads') {
    return toolResult(message.id, {
      ok: true,
      preparedCount: 1,
      failedCount: 0,
      items: [{
        index: 0,
        ok: true,
        file: { fileName: 'python-campus.png', fileType: 'image/png', fileSize: GENERATED_PNG.length },
        upload: { url: UPLOAD_URL, method: uploadMethod, headers: { 'x-upload-key': 'header-secret' } },
        image: { path: OBJECT_PATH, fileName: 'python-campus.png' },
      }],
    });
  }
  return undefined;
}

function registrationStructuredContent(reused: boolean) {
  return {
    ok: true,
    completedCount: 1,
    failedCount: 0,
    items: [{
      index: 0,
      ok: true,
      path: OBJECT_PATH,
      reused,
      image: {
        url: 'https://public.example.test/python-campus.png',
        path: OBJECT_PATH,
        fileName: 'python-campus.png',
        fileSize: GENERATED_PNG.length,
        fileType: 'image/png',
        uploadedAt: '2026-09-10T00:00:00.000Z',
      },
      asset: {
        id: ASSET_ID,
        projectId: PROJECT_ID,
        name: 'python-campus.png',
        category: 'map',
        status: 'ready',
        storagePath: OBJECT_PATH,
        sha256: SHA256,
        width: 128,
        height: 128,
        hasTransparency: false,
        fileSize: GENERATED_PNG.length,
        mimeType: 'image/png',
        createdAt: '2026-09-10T00:00:00.000Z',
        updatedAt: '2026-09-10T00:00:00.000Z',
      },
    }],
  };
}

function acceptanceAdmin(deletedRows: string[], deletedObjects: string[]): AcceptanceAdmin {
  const row = {
    id: ASSET_ID,
    project_id: PROJECT_ID,
    created_by: ACCEPTANCE_USER_ID,
    name: 'python-campus.png',
    category: 'map',
    status: 'ready',
    mime_type: 'image/png',
    storage_path: OBJECT_PATH,
    sha256: SHA256,
    width: 128,
    height: 128,
    has_transparency: false,
    file_size: GENERATED_PNG.length,
    created_at: '2026-09-10T00:00:00.000Z',
    updated_at: '2026-09-10T00:00:00.000Z',
  };
  return {
    readAsset: async () => row,
    findAssets: async () => [row],
    aggregateAssets: async () => [{
      id: `manual:${ASSET_ID}`,
      projectId: PROJECT_ID,
      name: 'python-campus.png',
      category: 'map',
      source: 'manual',
      sourceRef: { kind: 'project_game_assets', id: ASSET_ID },
      storagePath: OBJECT_PATH,
      sha256: SHA256,
      width: 128,
      height: 128,
      fileSize: GENERATED_PNG.length,
      status: 'ready',
    }],
    deleteAsset: async target => {
      deletedRows.push(`${target.assetId}:${target.projectId}:${target.storagePath}`);
    },
    deleteObject: async storagePath => {
      deletedObjects.push(storagePath);
    },
  };
}

describe('Python-generated project asset acceptance', () => {
  it('describes deterministic PNG output as upload metadata', () => {
    expect(pythonPixelArtSource).toContain('import struct');
    expect(pythonPixelArtSource).toContain('import zlib');
    expect(inventoryGeneratedPng(GENERATED_PNG, 'python-campus.png')).toEqual({
      fileName: 'python-campus.png',
      fileType: 'image/png',
      fileSize: GENERATED_PNG.length,
    });
  });

  it('redacts credential-bearing evidence fields', () => {
    expect(redactEvidence({ uploadUrl: UPLOAD_URL })).not.toContain('signed-secret');
  });

  it('uses a minimal Python environment and keeps local data outside MCP JSON', async () => {
    const order: string[] = [];
    const mcpBodies: Array<Record<string, unknown>> = [];
    const pythonCalls: Array<{
      executable: string;
      args: readonly string[];
      environment: Readonly<Record<string, string>>;
    }> = [];
    const cleanupRows: Array<{ assetId: string; projectId: string; storagePath: string }> = [];
    const cleanupObjects: string[] = [];
    let completionCount = 0;

    const pythonRunner: PythonRunner = async (executable, args, options) => {
      pythonCalls.push({ executable, args, environment: options.env });
      await writeFile(args[2], GENERATED_PNG);
    };
    const fetchMock = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === UPLOAD_URL) {
        order.push('HTTP PUT');
        expect(init?.method).toBe('PUT');
        expect(new Headers(init?.headers).get('x-upload-key')).toBe('header-secret');
        expect(new Uint8Array(init?.body as ArrayBuffer)).toEqual(GENERATED_PNG);
        return new Response(null, { status: 200 });
      }

      const message = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
        params?: { name?: string; arguments?: Record<string, unknown> };
      };
      mcpBodies.push(message as unknown as Record<string, unknown>);
      if (message.method === 'initialize') {
        order.push('initialize');
        return rpcResult(message.id, { capabilities: { tools: {} } });
      }
      if (message.method === 'tools/list') {
        order.push('tools/list');
        return rpcResult(message.id, { tools: [
          { name: 'list_projects' },
          { name: 'prepare_image_uploads' },
          { name: 'complete_project_game_asset_uploads' },
        ] });
      }
      if (message.params?.name === 'list_projects') {
        order.push('list_projects');
        return toolResult(message.id, {
          ok: true,
          returnedCount: 1,
          items: [{
            projectId: PROJECT_ID,
            name: 'Acceptance project',
            createdAt: '2026-09-10T00:00:00.000Z',
            role: 'editor',
            capabilities: { read: true, create: true, update: true },
          }],
        });
      }
      if (message.params?.name === 'prepare_image_uploads') {
        order.push('prepare_image_uploads');
        return toolResult(message.id, {
          ok: true,
          preparedCount: 1,
          failedCount: 0,
          items: [{
            index: 0,
            ok: true,
            file: { fileName: 'python-campus.png', fileType: 'image/png', fileSize: GENERATED_PNG.length },
            upload: { url: UPLOAD_URL, method: 'PUT', headers: { 'x-upload-key': 'header-secret' } },
            image: { path: OBJECT_PATH, fileName: 'python-campus.png' },
          }],
        });
      }
      if (message.params?.name === 'complete_project_game_asset_uploads') {
        order.push('complete_project_game_asset_uploads');
        completionCount += 1;
        return toolResult(message.id, {
          ok: true,
          completedCount: 1,
          failedCount: 0,
          items: [{
            index: 0,
            ok: true,
            path: OBJECT_PATH,
            reused: completionCount === 2,
            image: {
              url: 'https://public.example.test/python-campus.png',
              path: OBJECT_PATH,
              fileName: 'python-campus.png',
              fileSize: GENERATED_PNG.length,
              fileType: 'image/png',
              uploadedAt: '2026-09-10T00:00:00.000Z',
            },
            asset: {
              id: ASSET_ID,
              projectId: PROJECT_ID,
              name: 'python-campus.png',
              category: 'map',
              status: 'ready',
              storagePath: OBJECT_PATH,
              sha256: SHA256,
              width: 128,
              height: 128,
              hasTransparency: false,
              fileSize: GENERATED_PNG.length,
              mimeType: 'image/png',
              createdAt: '2026-09-10T00:00:00.000Z',
              updatedAt: '2026-09-10T00:00:00.000Z',
            },
          }],
        });
      }
      throw new Error(`Unexpected MCP call: ${message.method}`);
    });

    const row = {
      id: ASSET_ID,
      project_id: PROJECT_ID,
      created_by: ACCEPTANCE_USER_ID,
      name: 'python-campus.png',
      category: 'map',
      status: 'ready',
      mime_type: 'image/png',
      storage_path: OBJECT_PATH,
      sha256: SHA256,
      width: 128,
      height: 128,
      has_transparency: false,
      file_size: GENERATED_PNG.length,
      created_at: '2026-09-10T00:00:00.000Z',
      updated_at: '2026-09-10T00:00:00.000Z',
    };
    const admin: AcceptanceAdmin = {
      readAsset: async () => {
        order.push('authoritative database read-back');
        return row;
      },
      findAssets: async () => [row],
      aggregateAssets: async () => {
        order.push('Assets aggregation');
        return [{
          id: `manual:${ASSET_ID}`,
          projectId: PROJECT_ID,
          name: 'python-campus.png',
          category: 'map',
          source: 'manual',
          sourceRef: { kind: 'project_game_assets', id: ASSET_ID },
          storagePath: OBJECT_PATH,
          sha256: SHA256,
          width: 128,
          height: 128,
          fileSize: GENERATED_PNG.length,
          status: 'ready',
        }];
      },
      deleteAsset: async target => {
        cleanupRows.push(target);
      },
      deleteObject: async storagePath => {
        cleanupObjects.push(storagePath);
      },
    };

    const evidence = await runAcceptance({
      mcpUrl: MCP_URL,
      accessToken: 'mcp-access-secret',
      projectId: PROJECT_ID,
      supabaseUrl: 'https://project.supabase.co',
      serviceRoleKey: 'service-role-secret',
    }, { fetchImpl: fetchMock as typeof fetch, pythonRunner, admin });

    expect(order.slice(0, 8)).toEqual([
      'initialize',
      'tools/list',
      'list_projects',
      'prepare_image_uploads',
      'HTTP PUT',
      'complete_project_game_asset_uploads',
      'complete_project_game_asset_uploads',
      'authoritative database read-back',
    ]);
    expect(evidence).toEqual(expect.objectContaining({
      passed: true,
      projectId: PROJECT_ID,
      assetId: ASSET_ID,
      objectPath: OBJECT_PATH,
      sha256: SHA256,
      dimensions: { width: 128, height: 128 },
      registration: { insertedCount: 1, sameAssetId: true, replayReused: true },
      readBack: { matched: true },
      aggregation: { matched: true, source: 'manual', category: 'map' },
      cleanup: { registryRowDeleted: true, storageObjectDeleted: true, temporaryDirectoryRemoved: true },
    }));
    expect(pythonCalls).toHaveLength(1);
    expect(pythonCalls[0].executable).toBe('python3');
    expect(pythonCalls[0].args.slice(0, 2)).toEqual(['-c', pythonPixelArtSource]);
    expect(Object.keys(pythonCalls[0].environment).sort()).toEqual(['LANG', 'LC_ALL', 'PATH']);
    for (const forbidden of [
      'MCP_ACCESS_TOKEN',
      'SUPABASE_SERVICE_ROLE_KEY',
      'mcp-access-secret',
      'service-role-secret',
      'Bearer',
      UPLOAD_URL,
      'header-secret',
    ]) {
      expect(JSON.stringify(pythonCalls[0].environment)).not.toContain(forbidden);
    }

    const serializedBodies = JSON.stringify(mcpBodies);
    const localOutputPath = pythonCalls[0].args[2];
    for (const forbidden of [
      pythonPixelArtSource,
      localOutputPath,
      JSON.stringify(Array.from(GENERATED_PNG)),
      Buffer.from(GENERATED_PNG).toString('base64'),
      UPLOAD_URL,
      'header-secret',
    ]) {
      expect(serializedBodies).not.toContain(forbidden);
    }
    expect(cleanupRows).toEqual([{ assetId: ASSET_ID, projectId: PROJECT_ID, storagePath: OBJECT_PATH }]);
    expect(cleanupObjects).toEqual([OBJECT_PATH]);
    const serializedEvidence = JSON.stringify(evidence);
    for (const forbidden of [UPLOAD_URL, 'header-secret', 'mcp-access-secret', 'service-role-secret', localOutputPath]) {
      expect(serializedEvidence).not.toContain(forbidden);
    }
  });

  it('sanitizes an early Python failure without requiring an admin cleanup client', async () => {
    const evidence = await runAcceptance({
      mcpUrl: MCP_URL,
      accessToken: 'mcp-access-secret',
      projectId: PROJECT_ID,
      supabaseUrl: 'not-a-url',
      serviceRoleKey: 'service-role-secret',
    }, {
      pythonRunner: async () => {
        throw new Error(`Python failed while running ${pythonPixelArtSource}`);
      },
    });

    expect(evidence).toEqual(expect.objectContaining({
      passed: false,
      cleanup: {
        registryRowDeleted: true,
        storageObjectDeleted: true,
        temporaryDirectoryRemoved: true,
      },
    }));
    expect(JSON.stringify(evidence)).not.toContain(pythonPixelArtSource);
    expect(JSON.stringify(evidence)).not.toContain('mcp-access-secret');
    expect(JSON.stringify(evidence)).not.toContain('service-role-secret');
  });

  it('cleans the exact prepared object when the PUT outcome is unknown', async () => {
    const deletedObjects: string[] = [];
    const admin: AcceptanceAdmin = {
      readAsset: async () => null,
      findAssets: async () => [],
      aggregateAssets: async () => [],
      deleteAsset: async () => undefined,
      deleteObject: async storagePath => {
        deletedObjects.push(storagePath);
      },
    };
    const fetchMock = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === UPLOAD_URL) throw new Error(`connection lost for ${UPLOAD_URL}`);
      const message = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
        params?: { name?: string };
      };
      if (message.method === 'initialize') {
        return rpcResult(message.id, { capabilities: { tools: {} } });
      }
      if (message.method === 'tools/list') {
        return rpcResult(message.id, { tools: [
          { name: 'list_projects' },
          { name: 'prepare_image_uploads' },
          { name: 'complete_project_game_asset_uploads' },
        ] });
      }
      if (message.params?.name === 'list_projects') {
        return toolResult(message.id, {
          ok: true,
          items: [{
            projectId: PROJECT_ID,
            role: 'editor',
            capabilities: { read: true, create: true, update: true },
          }],
        });
      }
      if (message.params?.name === 'prepare_image_uploads') {
        return toolResult(message.id, {
          ok: true,
          preparedCount: 1,
          failedCount: 0,
          items: [{
            index: 0,
            ok: true,
            upload: { url: UPLOAD_URL, method: 'PUT', headers: { 'x-upload-key': 'header-secret' } },
            image: { path: OBJECT_PATH, fileName: 'python-campus.png' },
          }],
        });
      }
      throw new Error(`unexpected ${message.method}`);
    });

    const evidence = await runAcceptance({
      mcpUrl: MCP_URL,
      accessToken: 'mcp-access-secret',
      projectId: PROJECT_ID,
      supabaseUrl: 'https://project.supabase.co',
      serviceRoleKey: 'service-role-secret',
    }, {
      fetchImpl: fetchMock as typeof fetch,
      pythonRunner: async (_executable, args) => writeFile(args[2], GENERATED_PNG),
      admin,
    });

    expect(evidence.passed).toBe(false);
    expect(evidence.cleanup).toEqual({
      registryRowDeleted: true,
      storageObjectDeleted: true,
      temporaryDirectoryRemoved: true,
    });
    expect(deletedObjects).toEqual([OBJECT_PATH]);
    expect(JSON.stringify(evidence)).not.toContain('signed-secret');
    expect(JSON.stringify(evidence)).not.toContain('header-secret');
  });

  it('recovers a committed registration after its first response is lost', async () => {
    const completionArguments: string[] = [];
    const deletedRows: string[] = [];
    const deletedObjects: string[] = [];
    let completions = 0;
    const fetchMock = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === UPLOAD_URL) return new Response(null, { status: 200 });
      const message = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
        params?: { name?: string; arguments?: Record<string, unknown> };
      };
      const prelude = preparedFlowResponse(message);
      if (prelude) return prelude;
      if (message.params?.name === 'complete_project_game_asset_uploads') {
        completions += 1;
        completionArguments.push(JSON.stringify(message.params.arguments));
        if (completions === 1) throw new Error('response lost after registration committed');
        return toolResult(message.id, registrationStructuredContent(true));
      }
      throw new Error(`Unexpected MCP call: ${message.method}`);
    });

    const evidence = await runAcceptance({
      mcpUrl: MCP_URL,
      accessToken: 'mcp-access-secret',
      projectId: PROJECT_ID,
      supabaseUrl: 'https://project.supabase.co',
      serviceRoleKey: 'service-role-secret',
    }, {
      fetchImpl: fetchMock as typeof fetch,
      pythonRunner: async (_executable, args) => writeFile(args[2], GENERATED_PNG),
      admin: acceptanceAdmin(deletedRows, deletedObjects),
    });

    expect(evidence).toEqual(expect.objectContaining({
      passed: true,
      assetId: ASSET_ID,
      registration: { insertedCount: 1, sameAssetId: true, replayReused: true },
      cleanup: { registryRowDeleted: true, storageObjectDeleted: true, temporaryDirectoryRemoved: true },
    }));
    expect(completionArguments).toHaveLength(2);
    expect(completionArguments[1]).toBe(completionArguments[0]);
    expect(deletedRows).toEqual([`${ASSET_ID}:${PROJECT_ID}:${OBJECT_PATH}`]);
    expect(deletedObjects).toEqual([OBJECT_PATH]);
  });

  it('cleans the exact committed row and object after both completion responses are lost', async () => {
    const completionArguments: string[] = [];
    const deletedRows: string[] = [];
    const deletedObjects: string[] = [];
    let lookupCount = 0;
    const row = {
      id: ASSET_ID,
      project_id: PROJECT_ID,
      created_by: ACCEPTANCE_USER_ID,
      name: 'python-campus.png',
      category: 'map',
      status: 'ready',
      mime_type: 'image/png',
      storage_path: OBJECT_PATH,
      sha256: SHA256,
      width: 128,
      height: 128,
      has_transparency: false,
      file_size: GENERATED_PNG.length,
      created_at: '2026-09-10T00:00:00.000Z',
      updated_at: '2026-09-10T00:00:00.000Z',
    };
    const fetchMock = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === UPLOAD_URL) return new Response(null, { status: 200 });
      const message = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
        params?: { name?: string; arguments?: Record<string, unknown> };
      };
      const prelude = preparedFlowResponse(message);
      if (prelude) return prelude;
      if (message.params?.name === 'complete_project_game_asset_uploads') {
        completionArguments.push(JSON.stringify(message.params.arguments));
        throw new Error('response lost after registration committed');
      }
      throw new Error(`Unexpected MCP call: ${message.method}`);
    });
    const admin = {
      readAsset: async () => null,
      findAssets: async (projectId: string, storagePath: string) => {
        lookupCount += 1;
        expect({ projectId, storagePath }).toEqual({ projectId: PROJECT_ID, storagePath: OBJECT_PATH });
        return [row];
      },
      aggregateAssets: async () => [],
      deleteAsset: async (target: { assetId: string; projectId: string; storagePath: string }) => {
        deletedRows.push(`${target.assetId}:${target.projectId}:${target.storagePath}`);
      },
      deleteObject: async (storagePath: string) => {
        deletedObjects.push(storagePath);
      },
    };

    const evidence = await runAcceptance({
      mcpUrl: MCP_URL,
      accessToken: 'mcp-access-secret',
      projectId: PROJECT_ID,
      supabaseUrl: 'https://project.supabase.co',
      serviceRoleKey: 'service-role-secret',
    }, {
      fetchImpl: fetchMock as typeof fetch,
      pythonRunner: async (_executable, args) => writeFile(args[2], GENERATED_PNG),
      admin,
    });

    expect(evidence.passed).toBe(false);
    expect(completionArguments).toHaveLength(2);
    expect(completionArguments[1]).toBe(completionArguments[0]);
    expect(lookupCount).toBe(1);
    expect(deletedRows).toEqual([`${ASSET_ID}:${PROJECT_ID}:${OBJECT_PATH}`]);
    expect(deletedObjects).toEqual([OBJECT_PATH]);
    expect(evidence.cleanup).toEqual({
      registryRowDeleted: true,
      storageObjectDeleted: true,
      temporaryDirectoryRemoved: true,
    });
  });

  it('retains the object when post-registration lookup metadata is ambiguous', async () => {
    const deletedRows: string[] = [];
    const deletedObjects: string[] = [];
    const fetchMock = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === UPLOAD_URL) return new Response(null, { status: 200 });
      const message = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
        params?: { name?: string };
      };
      const prelude = preparedFlowResponse(message);
      if (prelude) return prelude;
      if (message.params?.name === 'complete_project_game_asset_uploads') {
        throw new Error('response lost after registration may have committed');
      }
      throw new Error(`Unexpected MCP call: ${message.method}`);
    });
    const admin = {
      readAsset: async () => null,
      findAssets: async () => [{
        id: ASSET_ID,
        project_id: PROJECT_ID,
        created_by: ACCEPTANCE_USER_ID,
        name: 'python-campus.png',
        category: 'map',
        status: 'ready',
        mime_type: 'image/png',
        storage_path: OBJECT_PATH,
        sha256: '0'.repeat(64),
        width: 128,
        height: 128,
        has_transparency: false,
        file_size: GENERATED_PNG.length,
      }],
      aggregateAssets: async () => [],
      deleteAsset: async (target: { assetId: string; projectId: string; storagePath: string }) => {
        deletedRows.push(`${target.assetId}:${target.projectId}:${target.storagePath}`);
      },
      deleteObject: async (storagePath: string) => {
        deletedObjects.push(storagePath);
      },
    };

    const evidence = await runAcceptance({
      mcpUrl: MCP_URL,
      accessToken: 'mcp-access-secret',
      projectId: PROJECT_ID,
      supabaseUrl: 'https://project.supabase.co',
      serviceRoleKey: 'service-role-secret',
    }, {
      fetchImpl: fetchMock as typeof fetch,
      pythonRunner: async (_executable, args) => writeFile(args[2], GENERATED_PNG),
      admin,
    });

    expect(evidence.passed).toBe(false);
    expect(deletedRows).toEqual([]);
    expect(deletedObjects).toEqual([]);
    expect(evidence.cleanup).toEqual({
      registryRowDeleted: false,
      storageObjectDeleted: false,
      temporaryDirectoryRemoved: true,
    });
    expect(JSON.stringify(evidence.errors)).toContain('registry lookup');
  });

  it('rejects a prepared upload method other than exactly PUT', async () => {
    let uploadFetches = 0;
    const deletedObjects: string[] = [];
    const fetchMock = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === UPLOAD_URL) {
        uploadFetches += 1;
        return new Response(null, { status: 200 });
      }
      const message = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
        params?: { name?: string };
      };
      const response = preparedFlowResponse(message, 'POST');
      if (response) return response;
      throw new Error(`Unexpected MCP call: ${message.method}`);
    });

    const evidence = await runAcceptance({
      mcpUrl: MCP_URL,
      accessToken: 'mcp-access-secret',
      projectId: PROJECT_ID,
      supabaseUrl: 'https://project.supabase.co',
      serviceRoleKey: 'service-role-secret',
    }, {
      fetchImpl: fetchMock as typeof fetch,
      pythonRunner: async (_executable, args) => writeFile(args[2], GENERATED_PNG),
      admin: acceptanceAdmin([], deletedObjects),
    });

    expect(evidence.passed).toBe(false);
    expect(uploadFetches).toBe(0);
    expect(deletedObjects).toEqual([]);
  });

  it('redacts an alternate generated output path from evidence', () => {
    const probe = String.raw`
      import acceptance from './scripts/accept-python-generated-asset-writeback.ts';
      const { runAcceptance } = acceptance;
      let generatedOutputPath = '';
      const evidence = await runAcceptance({
        mcpUrl: '${MCP_URL}',
        accessToken: 'mcp-access-secret',
        projectId: '${PROJECT_ID}',
        supabaseUrl: 'https://project.supabase.co',
        serviceRoleKey: 'service-role-secret',
      }, {
        pythonRunner: async (_executable, args) => {
          generatedOutputPath = args[2];
          throw new Error('failed to write ' + generatedOutputPath);
        },
      });
      process.stdout.write(JSON.stringify({ generatedOutputPath, evidence }));
    `;
    const result = spawnSync(process.execPath, [
      '--import', 'tsx', '--input-type=module', '--eval', probe,
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, TMPDIR: '/dev/shm' },
    });
    const output = JSON.parse(result.stdout) as { generatedOutputPath: string; evidence: unknown };

    expect(result.status).toBe(0);
    expect(output.generatedOutputPath).toMatch(/^\/dev\/shm\/keco-python-asset-/);
    expect(JSON.stringify(output.evidence)).not.toContain(output.generatedOutputPath);
  });

  it('keeps a user-supplied evidence path out of top-level stderr', () => {
    const outputPath = '/dev/shm/missing-keco-evidence-parent/private-output.json';
    const result = spawnSync(process.execPath, [
      '--import', 'tsx',
      path.join(process.cwd(), 'scripts/accept-python-generated-asset-writeback.ts'),
      '--mcp-url', MCP_URL,
      '--project-id', 'invalid-project-id',
      '--output', outputPath,
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        MCP_ACCESS_TOKEN: 'mcp-access-secret',
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('Acceptance failed.\n');
    expect(result.stderr).not.toContain(outputPath);
    expect(result.stderr).not.toContain('private-output.json');
  });

});
