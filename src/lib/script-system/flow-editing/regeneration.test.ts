import type { SupabaseClient } from '@supabase/supabase-js';
import { prepareFlowRegeneration } from './regeneration';
jest.mock('@/lib/documents/documentStateGateway', () => ({ documentStateGateway: { read: jest.fn(async () => ({
  projectId: 'project', token: { epoch: 1, revision: 2 }, updateTail: [],
  markdown: '<BlockAnchor id="11111111-1111-4111-8111-111111111111" />Hello',
})) } }));
describe('flow generation coordinator', () => {
  it('allocates independent terminal identities for staging and retains references by label', async () => {
    const fields = ['Content', 'Type', 'Label', 'Commands', 'Option0', 'Option0_Next'].map(label => ({ id: label, label, data_type: 'string' }));
    const old = { library: { id: 'old', source_document_id: 'document' }, fields,
      document: { id: 'document', epoch: 1, revision: 2, updates: [] },
      assets: [{ id: 'old-row', propertyValues: { Content: 'Hello', Type: '4', Label: 'A', Option0: 'Exit', Option0_Next: 'Jump Stop' } },
        { id: 'old-end', propertyValues: { Type: '4', Commands: 'End', Label: 'Stop', Content: '' } }],
      state: { version: 1, bindings: [{ rowId: 'old-row', blockId: '11111111-1111-4111-8111-111111111111', role: 'text', sourceText: 'Hello' }], terminalIds: ['old-end'] },
    };
    const client = { rpc: jest.fn(async (name: string) => name === 'script_flow_regeneration_context'
      ? { data: { data: old, projectId: 'project', fingerprint: 'hash' }, error: null }
      : { data: { library: { id: 'stage' }, fields, assets: [{ id: 'new-row', propertyValues: { Content: 'Hello', Type: '4', Label: 'Generated' } }] }, error: null }) } as unknown as SupabaseClient;
    const result = await prepareFlowRegeneration(client, 'job', 'stage');
    expect(result!.p_rows[0].values.Option0_Next).toBe('Jump Stop');
    expect(result!.p_rows[1].id).not.toBe('old-end');
    expect(result!.p_state.terminalIds).toEqual([result!.p_rows[1].id]);
    expect(result!.p_rows[1].values.Label).toBe('Stop');
  });
  it('does not inherit an unrelated existing Script when exporting a new library', async () => {
    const client = { rpc: jest.fn(async () => ({ data: null, error: null })) } as unknown as SupabaseClient;
    expect(await prepareFlowRegeneration(client, 'new-job', 'stage')).toBeNull();
  });
});
