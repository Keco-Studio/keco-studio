import { describe, expect, it } from '@jest/globals';
import {
  applyMappingDrag,
  buildMappingLayout,
  fillEmptySlotsPositionally,
  finalizeFieldMapping,
  orderSlotsForDisplay,
  slotMappingStatus,
} from '@/lib/simulation/mappingLayout';
import type { FieldMapping, SimulationFieldDefinition, StudioColumnDefinition } from '@/lib/simulation/types';

const FIELD_IDS = ['id', 'name', 'el', 'hp'] as const;

describe('buildMappingLayout', () => {
  it('aligns mapped columns to field order and parks extras in unmapped', () => {
    const mapping: FieldMapping = {
      id: 'char_id',
      name: 'display_name',
      el: 'element',
    };
    const layout = buildMappingLayout(FIELD_IDS, mapping, [
      'char_id',
      'display_name',
      'class_name',
      'element',
      'base_hp',
    ]);

    expect(layout.slots).toEqual([
      { fieldId: 'id', columnId: 'char_id' },
      { fieldId: 'name', columnId: 'display_name' },
      { fieldId: 'el', columnId: 'element' },
      { fieldId: 'hp', columnId: null },
    ]);
    expect(layout.unmapped).toEqual(['class_name', 'base_hp']);
  });
});

describe('orderSlotsForDisplay', () => {
  it('keeps filled slots ahead of empty drop rows', () => {
    expect(
      orderSlotsForDisplay([
        { fieldId: 'id', columnId: 'char_id' },
        { fieldId: 'name', columnId: null },
        { fieldId: 'el', columnId: 'element' },
        { fieldId: 'hp', columnId: null },
      ]),
    ).toEqual([
      { fieldId: 'id', columnId: 'char_id' },
      { fieldId: 'el', columnId: 'element' },
      { fieldId: 'name', columnId: null },
      { fieldId: 'hp', columnId: null },
    ]);
  });
});

describe('finalizeFieldMapping', () => {
  it('fills alias gaps then parks only true extras below field count', () => {
    const columns: StudioColumnDefinition[] = [
      { id: 'character_id', label: 'character_id', valueType: 'string' },
      { id: 'name', label: 'name', valueType: 'string' },
      { id: 'el', label: 'el', valueType: 'string' },
      { id: 'hp', label: 'hp', valueType: 'number' },
      { id: 'atk', label: 'atk', valueType: 'number' },
      { id: 'def', label: 'def', valueType: 'number' },
      { id: 'spd', label: 'spd', valueType: 'number' },
      { id: 'mp', label: 'mp', valueType: 'number' },
      { id: 'skill_ids', label: 'skill_ids', valueType: 'string' },
    ];
    const finalized = finalizeFieldMapping('characters', { name: 'name', el: 'el' }, columns);
    expect(finalized.name).toBe('name');
    expect(finalized.el).toBe('el');
    expect(finalized.id).toBe('character_id');
    expect(finalized.hp).toBe('hp');
    expect(finalized.atk).toBe('atk');
    expect(finalized.def).toBe('def');
    expect(finalized.spd).toBe('spd');
    expect(finalized.mp).toBe('mp');
    const layout = buildMappingLayout(
      ['id', 'name', 'el', 'hp', 'atk', 'def', 'spd', 'mp'],
      finalized,
      columns.map((column) => column.id),
    );
    expect(layout.slots.every((slot) => slot.columnId)).toBe(true);
    expect(layout.unmapped).toEqual(['skill_ids']);
  });

  it('repairs an AI swap when exact level and exp column names are available', () => {
    const columns: StudioColumnDefinition[] = [
      { id: 'level', label: 'level', valueType: 'number' },
      { id: 'need_exp', label: 'need_exp', valueType: 'number' },
      { id: 'grant_sp', label: 'grant_sp', valueType: 'number' },
    ];
    const finalized = finalizeFieldMapping('level', {
      level: 'need_exp',
      exp: 'level',
      sp: 'grant_sp',
    }, columns);

    expect(finalized).toEqual({
      level: 'level',
      exp: 'need_exp',
      sp: 'grant_sp',
    });
  });
});

describe('fillEmptySlotsPositionally', () => {
  it('only leaves empty slots when there are fewer columns than fields', () => {
    const mapping = fillEmptySlotsPositionally(
      ['id', 'name', 'el'],
      { name: 'n' },
      ['n', 'extra'],
    );
    expect(mapping).toEqual({ name: 'n', id: 'extra' });
    expect(mapping.el).toBeUndefined();
  });
});

describe('applyMappingDrag', () => {
  it('swaps two mapped slots', () => {
    const mapping: FieldMapping = { el: 'element', name: 'class_name' };
    const next = applyMappingDrag(
      mapping,
      { kind: 'slot', fieldId: 'el' },
      { kind: 'slot', fieldId: 'name' },
    );
    expect(next).toEqual({ el: 'class_name', name: 'element' });
  });

  it('assigns an unmapped column into a slot and evicts the occupant', () => {
    const mapping: FieldMapping = { el: 'element' };
    const next = applyMappingDrag(
      mapping,
      { kind: 'unmapped', columnId: 'class_name' },
      { kind: 'slot', fieldId: 'el' },
    );
    expect(next).toEqual({ el: 'class_name' });
  });

  it('clears a slot when dragged to unmapped', () => {
    const mapping: FieldMapping = { el: 'element', name: 'display_name' };
    const next = applyMappingDrag(
      mapping,
      { kind: 'slot', fieldId: 'el' },
      { kind: 'unmapped' },
    );
    expect(next).toEqual({ name: 'display_name' });
  });
});

describe('slotMappingStatus', () => {
  const field = {
    id: 'hp',
    label: 'HP',
    required: true,
    valueTypes: ['number'],
  } satisfies SimulationFieldDefinition;

  const mpField = {
    id: 'mp',
    label: 'MP',
    required: true,
    aliases: ['mp', 'mp cost', 'mana cost'],
    valueTypes: ['number'],
  } satisfies SimulationFieldDefinition;

  it('flags missing required slots and true type mismatches', () => {
    expect(slotMappingStatus(field, null)).toBe('empty-required');
    expect(slotMappingStatus(field, { id: 'base_hp', label: 'Base HP', valueType: 'number' })).toBe('ok');
    expect(slotMappingStatus(field, { id: 'name', label: 'Name', valueType: 'boolean' })).toBe('incompatible');
  });

  it('accepts case-only name differences and string columns mapped to number fields', () => {
    expect(slotMappingStatus(mpField, { id: 'MP', label: 'MP', valueType: 'string' })).toBe('ok');
    expect(slotMappingStatus(mpField, { id: 'mp_cost', label: 'mp cost', valueType: 'string' })).toBe('ok');
    expect(slotMappingStatus(field, { id: 'power', label: 'Power', valueType: 'string' })).toBe('ok');
  });
});
