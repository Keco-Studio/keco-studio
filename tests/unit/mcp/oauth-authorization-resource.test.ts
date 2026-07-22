import type { SupabaseClient } from '@supabase/supabase-js';
import { getOAuthAuthorizationResource } from '@/lib/mcp/oauthAuthorizationResource';

function clientWithRpcResult(result: { data: unknown; error: unknown }) {
  const rpc = jest.fn().mockResolvedValue(result);
  return {
    client: { rpc } as unknown as SupabaseClient,
    rpc,
  };
}

it('loads a scalar OAuth authorization resource from the RPC', async () => {
  const resource = 'https://abc.supabase.co/functions/v1/mcp/project-1';
  const { client, rpc } = clientWithRpcResult({ data: resource, error: null });

  await expect(getOAuthAuthorizationResource(client, 'auth-1')).resolves.toBe(resource);
  expect(rpc).toHaveBeenCalledWith('get_oauth_authorization_resource', {
    p_authorization_id: 'auth-1',
  });
  expect(rpc).toHaveBeenCalledTimes(1);
});

it('returns null when the RPC returns null', async () => {
  const { client } = clientWithRpcResult({ data: null, error: null });

  await expect(getOAuthAuthorizationResource(client, 'auth-1')).resolves.toBeNull();
});

it('returns null when the RPC returns malformed non-string data', async () => {
  const { client } = clientWithRpcResult({ data: { resource: 'unexpected' }, error: null });

  await expect(getOAuthAuthorizationResource(client, 'auth-1')).resolves.toBeNull();
});

it('rethrows the RPC error unchanged', async () => {
  const rpcError = new Error('RPC failed');
  const { client } = clientWithRpcResult({ data: null, error: rpcError });

  await expect(getOAuthAuthorizationResource(client, 'auth-1')).rejects.toBe(rpcError);
});
