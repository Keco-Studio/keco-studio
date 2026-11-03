import { parseFlowRequest } from '@/lib/script-system/flow-editing/requests';
const id = '11111111-1111-4111-8111-111111111111';
describe('flow command API boundary', () => {
  const valid = { expectedFingerprint: 'a'.repeat(32), requestId: id, edits: [{ type: 'outlet', rowId: id, target: { kind: 'end' } }] };
  it('only accepts commands with a version and request identity', () => {
    expect(parseFlowRequest(valid).edits).toHaveLength(1);
    expect(() => parseFlowRequest({ ...valid, actorId: id })).toThrow();
    expect(() => parseFlowRequest({ ...valid, rows: [] })).toThrow();
    expect(() => parseFlowRequest({ ...valid, expectedFingerprint: undefined })).toThrow();
  });
  it('requires a target and nonempty button text', () => {
    expect(() => parseFlowRequest({ ...valid, edits: [{ type: 'option', rowId: id, optionIndex: 0, text: '' }] })).toThrow();
  });
});
