import { resolvePropertyValues } from '../../../src/lib/agent/field-resolver';

type FieldDef = { id: string; label: string };

function fakeSupabase(defs: FieldDef[]) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return Promise.resolve({ data: defs, error: null });
            },
          };
        },
      };
    },
  } as unknown as Parameters<typeof resolvePropertyValues>[0];
}

describe('resolvePropertyValues', () => {
  const defs: FieldDef[] = [
    { id: 'uuid-type', label: 'type' },
    { id: 'uuid-tag', label: 'tags' },
  ];

  it('translates semantic field names to field ids', async () => {
    const res = await resolvePropertyValues(fakeSupabase(defs), 'lib', { type: 'character', tags: 'NPC' });
    expect(res.resolved).toEqual({ 'uuid-type': 'character', 'uuid-tag': 'NPC' });
    expect(res.unresolved).toEqual([]);
  });

  it('reports unknown field names with the available list', async () => {
    const res = await resolvePropertyValues(fakeSupabase(defs), 'lib', { type: 'character', color: 'red' });
    expect(res.resolved).toEqual({ 'uuid-type': 'character' });
    expect(res.unresolved).toEqual(['color']);
    expect(res.availableFields).toEqual(['type', 'tags']);
  });

  it('passes through field ids supplied directly', async () => {
    const res = await resolvePropertyValues(fakeSupabase(defs), 'lib', { 'uuid-tag': 'boss' });
    expect(res.resolved).toEqual({ 'uuid-tag': 'boss' });
    expect(res.unresolved).toEqual([]);
  });

  it('matches case-insensitively after trimming', async () => {
    const res = await resolvePropertyValues(
      fakeSupabase([{ id: 'uuid-name', label: 'Name' }]),
      'lib',
      { ' name ': 'Nova' }
    );
    expect(res.resolved).toEqual({ 'uuid-name': 'Nova' });
  });

  it('returns empty resolution for empty input', async () => {
    const res = await resolvePropertyValues(fakeSupabase(defs), 'lib', undefined);
    expect(res.resolved).toEqual({});
    expect(res.availableFields).toEqual(['type', 'tags']);
  });
});
