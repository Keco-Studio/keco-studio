import { describe, expect, it, jest } from '@jest/globals';

jest.mock('server-only', () => ({}));

import {
  checkpointProjectTemplateInstantiation,
  claimProjectTemplateInstantiation,
  cleanupProjectTemplateInstantiation,
  completeProjectTemplateInstantiation,
  failProjectTemplateInstantiation,
} from './instantiationStore.server';

const ids = {
  owner: '4ad41d3b-4723-463f-b103-0380c61372ed',
  request: '8c13deea-c9cb-43b3-bc67-5afe5a0375e7',
  instantiation: '0f248cb6-f235-4816-b78b-4a6b8ad52f52',
  project: 'b367aafd-c893-47b9-b02b-939ce8aac3bc',
  folder: 'f88fe67f-b5c4-460b-ae6f-9eb828725f61',
  designSystem: '186a29e2-6120-4d12-a3d1-1c11bd1458cb',
  cleanup: '3479a129-9746-47c5-98b8-32f8f7ddfe9e',
};

function clientWith(data: unknown, error: unknown = null) {
  const rpc = jest.fn(async (_name: string, _args: Record<string, unknown>) => ({ data, error }));
  return { client: { rpc } as never, rpc };
}

const claimRow = {
  id: ids.instantiation,
  claimed: true,
  status: 'running',
  project_id: null,
  default_folder_id: null,
  design_system_id: null,
};

describe('project template instantiation store', () => {
  it('claims a request and exposes only the validated state contract', async () => {
    const { client, rpc } = clientWith([claimRow]);

    await expect(claimProjectTemplateInstantiation(client, {
      ownerId: ids.owner,
      requestId: ids.request,
      templateKey: 'tactical-deckbuilder',
      templateVersion: 1,
    })).resolves.toEqual({
      id: ids.instantiation,
      claimed: true,
      status: 'running',
      projectId: null,
      defaultFolderId: null,
      designSystemId: null,
    });
    expect(rpc).toHaveBeenCalledWith('claim_project_template_instantiation', {
      p_owner_id: ids.owner,
      p_request_id: ids.request,
      p_template_key: 'tactical-deckbuilder',
      p_template_version: 1,
    });
  });

  it('rejects malformed claim responses instead of trusting service data', async () => {
    const { client } = clientWith([{ ...claimRow, claimed: 'true' }]);

    await expect(claimProjectTemplateInstantiation(client, {
      ownerId: ids.owner,
      requestId: ids.request,
      templateKey: 'tactical-deckbuilder',
      templateVersion: 1,
    })).rejects.toThrow('Invalid project template instantiation response');
  });

  it('checkpoints, completes, and fails only the expected owner state', async () => {
    const checkpoint = clientWith([{
      ...claimRow,
      project_id: ids.project,
      default_folder_id: ids.folder,
      design_system_id: ids.designSystem,
    }]);
    await expect(checkpointProjectTemplateInstantiation(checkpoint.client, {
      instantiationId: ids.instantiation,
      ownerId: ids.owner,
      projectId: ids.project,
      defaultFolderId: ids.folder,
      designSystemId: ids.designSystem,
    })).resolves.toMatchObject({ projectId: ids.project, designSystemId: ids.designSystem });

    const complete = clientWith([{ ...claimRow, claimed: false, status: 'completed', project_id: ids.project, default_folder_id: ids.folder, design_system_id: ids.designSystem }]);
    await expect(completeProjectTemplateInstantiation(complete.client, {
      instantiationId: ids.instantiation,
      ownerId: ids.owner,
      projectId: ids.project,
      defaultFolderId: ids.folder,
      designSystemId: ids.designSystem,
    })).resolves.toMatchObject({ status: 'completed', claimed: false });

    const fail = clientWith([{ ...claimRow, claimed: false, status: 'failed' }]);
    await expect(failProjectTemplateInstantiation(fail.client, {
      instantiationId: ids.instantiation,
      ownerId: ids.owner,
      errorCode: 'TABLE_CREATION_FAILED',
    })).resolves.toMatchObject({ status: 'failed', claimed: false });
  });

  it('returns strictly validated durable cleanup job IDs', async () => {
    const { client } = clientWith([{ cleanup_job_id: ids.cleanup }]);

    await expect(cleanupProjectTemplateInstantiation(client, {
      instantiationId: ids.instantiation,
      ownerId: ids.owner,
      errorCode: 'ASSET_UPLOAD_FAILED',
    })).resolves.toEqual({ cleanupJobIds: [ids.cleanup] });

    const malformed = clientWith([{ cleanup_job_id: 'not-a-uuid' }]);
    await expect(cleanupProjectTemplateInstantiation(malformed.client, {
      instantiationId: ids.instantiation,
      ownerId: ids.owner,
      errorCode: 'ASSET_UPLOAD_FAILED',
    })).rejects.toThrow('Invalid project template cleanup response');
  });
});
