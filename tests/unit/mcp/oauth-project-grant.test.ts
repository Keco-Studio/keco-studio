import type { SupabaseClient } from '@supabase/supabase-js';
import {
  finalizeOAuthProjectGrant,
  prepareOAuthProjectGrant,
} from '@/lib/mcp/oauthProjectGrant';

function clientWithRpcResult(result: { data: unknown; error: unknown }) {
  const rpc = jest.fn().mockResolvedValue(result);
  return {
    client: { rpc } as unknown as SupabaseClient,
    rpc,
  };
}

it('prepares a grant for the exact authorization, project, and resource', async () => {
  const resource = 'https://abc.supabase.co/functions/v1/mcp/project-1';
  const { client, rpc } = clientWithRpcResult({ data: true, error: null });

  await expect(
    prepareOAuthProjectGrant(client, 'authorization-1', 'project-1', resource)
  ).resolves.toBe(true);
  expect(rpc).toHaveBeenCalledWith('prepare_oauth_project_grant', {
    p_authorization_id: 'authorization-1',
    p_project_id: 'project-1',
    p_resource: resource,
  });
});

it('fails closed when the database does not prepare a grant', async () => {
  const { client } = clientWithRpcResult({ data: null, error: null });

  await expect(
    prepareOAuthProjectGrant(client, 'authorization-1', 'project-1', 'resource')
  ).resolves.toBe(false);
});

it('rethrows a preparation RPC error', async () => {
  const rpcError = new Error('RPC failed');
  const { client } = clientWithRpcResult({ data: null, error: rpcError });

  await expect(
    prepareOAuthProjectGrant(client, 'authorization-1', 'project-1', 'resource')
  ).rejects.toBe(rpcError);
});

it('finalizes the exact prepared grant after approval', async () => {
  const resource = 'https://abc.supabase.co/functions/v1/mcp/project-1';
  const { client, rpc } = clientWithRpcResult({ data: true, error: null });

  await expect(
    finalizeOAuthProjectGrant(client, 'authorization-1', 'project-1', resource)
  ).resolves.toBe(true);
  expect(rpc).toHaveBeenCalledWith('finalize_oauth_project_grant', {
    p_authorization_id: 'authorization-1',
    p_project_id: 'project-1',
    p_resource: resource,
  });
});
