import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { BASIC } from '@/lib/simulation/data';
import { importSimulationSnapshot } from '@/lib/simulation/importAdapter';
import { loadSimulationProjectSources } from '@/lib/simulation/studioData';
import type { SimulationImportError } from '@/lib/simulation/types';
import { getLibraryAssetsWithProperties, getLibrarySchema } from '@/lib/services/libraryAssetsService';
import { listLibraries } from '@/lib/services/libraryService';
import {
  FIELD_KEYS,
  LIBRARY_IDS,
  PROJECT_ID,
  createValidMappings,
  createValidSources,
} from './fixtures';

jest.mock('@/lib/services/libraryService', () => ({ listLibraries: jest.fn() }));
jest.mock('@/lib/services/libraryAssetsService', () => ({
  getLibrarySchema: jest.fn(),
  getLibraryAssetsWithProperties: jest.fn(),
}));

function errorsFor(result: ReturnType<typeof importSimulationSnapshot>): SimulationImportError[] {
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors;
}

describe('strict Studio simulation import adapter', () => {
  it('imports UUID-keyed Studio rows into a sorted, isolated snapshot', () => {
    const sources = createValidSources();
    const mappings = createValidMappings();
    const result = importSimulationSnapshot({
      sourceProjectId: PROJECT_ID,
      sources,
      fieldMappings: mappings,
      importedAt: new Date('2026-07-21T02:03:04.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot).toMatchObject({
      sourceProjectId: PROJECT_ID,
      sourceLibraryIds: LIBRARY_IDS,
      importedAt: '2026-07-21T02:03:04.000Z',
      levelRules: [{ level: 1, exp: 0, sp: 1 }, { level: 2, exp: 200, sp: 0 }],
      skillCostRules: [{ lv: 1, cost: 0 }, { lv: 2, cost: 2 }],
      catalog: {
        characters: [{ id: 'hero', name: 'Hero', hp: 100, atk: 0 }],
        skills: [{ id: 'quake', name: 'Quake', status: '' }],
        basic: BASIC,
      },
    });
    expect(result.snapshot).not.toBe(sources);
    expect(result.snapshot.fieldMappings).not.toBe(mappings);
    expect(Object.isFrozen(result.snapshot)).toBe(true);

    sources.characters.assets[0].propertyValues[FIELD_KEYS.characters.name] = 'Mutated';
    mappings.characters.name = 'changed';
    expect(result.snapshot.catalog.characters[0].name).toBe('Hero');
    expect(result.snapshot.fieldMappings.characters.name).toBe(FIELD_KEYS.characters.name);
  });

  it('reports missing mappings and never substitutes AssetRow.name for canonical name', () => {
    const sources = createValidSources();
    const mappings = createValidMappings();
    delete mappings.characters.hp;
    delete sources.characters.assets[0].propertyValues[FIELD_KEYS.characters.name];

    const errors = errorsFor(importSimulationSnapshot({
      sourceProjectId: PROJECT_ID, sources, fieldMappings: mappings,
    }));

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'characters', code: 'missing_mapping', field: 'Base HP', assetId: null }),
      expect.objectContaining({ role: 'characters', code: 'missing_value', field: 'Name', assetName: 'Asset row label must not leak' }),
    ]));
  });

  it('rejects duplicate mappings and mappings to fields outside the schema', () => {
    const mappings = createValidMappings();
    mappings.characters.atk = mappings.characters.hp;
    mappings.skills.name = '99999999-0000-4000-8000-000000000999';

    const errors = errorsFor(importSimulationSnapshot({
      sourceProjectId: PROJECT_ID, sources: createValidSources(), fieldMappings: mappings,
    }));

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'characters', code: 'duplicate_mapping', field: 'Base ATK' }),
      expect.objectContaining({ role: 'skills', code: 'unresolved_field', field: 'Name' }),
    ]));
    expect(errors.every((error) => error.libraryId && error.libraryName && error.reason)).toBe(true);
  });

  it.each([
    ['array', []],
    ['object', { value: 12 }],
    ['partial decimal', '12px'],
    ['non-finite number', Number.POSITIVE_INFINITY],
    ['boolean', false],
  ])('rejects %s values as invalid types without treating false as missing', (_label, value) => {
    const sources = createValidSources();
    sources.characters.assets[0].propertyValues[FIELD_KEYS.characters.atk] = value;
    const errors = errorsFor(importSimulationSnapshot({
      sourceProjectId: PROJECT_ID, sources, fieldMappings: createValidMappings(),
    }));

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'characters', code: 'invalid_type', field: 'Base ATK' }),
    ]));
    expect(errors).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'characters', code: 'missing_value', field: 'Base ATK' }),
    ]));
  });

  it('collects invalid enum and numeric range errors across roles', () => {
    const sources = createValidSources();
    const character = sources.characters.assets[0].propertyValues;
    character[FIELD_KEYS.characters.el] = 'Water';
    character[FIELD_KEYS.characters.hp] = 0;
    character[FIELD_KEYS.characters.def] = -1;
    const skill = sources.skills.assets[0].propertyValues;
    skill[FIELD_KEYS.skills.kind] = 'attack';
    skill[FIELD_KEYS.skills.status] = 'poison';
    sources.level.assets[0].propertyValues[FIELD_KEYS.level.level] = 1.5;
    sources.skillc.assets[0].propertyValues[FIELD_KEYS.skillc.cost] = -1;

    const errors = errorsFor(importSimulationSnapshot({
      sourceProjectId: PROJECT_ID, sources, fieldMappings: createValidMappings(),
    }));

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid_enum', field: 'Element' }),
      expect.objectContaining({ code: 'invalid_range', field: 'Base HP' }),
      expect.objectContaining({ code: 'invalid_range', field: 'Base DEF' }),
      expect.objectContaining({ code: 'invalid_enum', field: 'Type' }),
      expect.objectContaining({ code: 'invalid_enum', field: 'Status' }),
      expect.objectContaining({ code: 'invalid_range', field: 'Level' }),
      expect.objectContaining({ code: 'invalid_range', field: 'SP Cost' }),
    ]));
  });

  it('rejects duplicate character and skill IDs plus the reserved basic skill ID', () => {
    const sources = createValidSources();
    sources.characters.assets.push(structuredClone(sources.characters.assets[0]));
    sources.characters.assets[1].id = 'duplicate-character-asset';
    sources.skills.assets[0].propertyValues[FIELD_KEYS.skills.id] = 'basic';
    sources.skills.assets.push(structuredClone(sources.skills.assets[0]));
    sources.skills.assets[1].id = 'duplicate-skill-asset';

    const errors = errorsFor(importSimulationSnapshot({
      sourceProjectId: PROJECT_ID, sources, fieldMappings: createValidMappings(),
    }));

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'characters', code: 'duplicate_id', field: 'Character ID' }),
      expect.objectContaining({ role: 'skills', code: 'duplicate_id', field: 'Skill ID' }),
      expect.objectContaining({ role: 'skills', code: 'reserved_id', field: 'Skill ID' }),
    ]));
  });

  it.each(['characters', 'skills', 'level', 'skillc'] as const)('rejects an empty %s source', (role) => {
    const sources = createValidSources();
    sources[role].assets = [];
    const errors = errorsFor(importSimulationSnapshot({
      sourceProjectId: PROJECT_ID, sources, fieldMappings: createValidMappings(),
    }));
    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ role, code: 'empty_source', assetId: null }),
    ]));
  });

  it('requires level and skill cost rules to be unique and contiguous from one', () => {
    const sources = createValidSources();
    sources.level.assets[1].propertyValues[FIELD_KEYS.level.level] = 2;
    sources.skillc.assets[1].propertyValues[FIELD_KEYS.skillc.lv] = 3;

    const errors = errorsFor(importSimulationSnapshot({
      sourceProjectId: PROJECT_ID, sources, fieldMappings: createValidMappings(),
    }));

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'level', code: 'duplicate_id', field: 'Level' }),
      expect.objectContaining({ role: 'level', code: 'invalid_sequence', field: 'Level' }),
      expect.objectContaining({ role: 'skillc', code: 'invalid_sequence', field: 'Skill Level' }),
    ]));
  });

  it('returns all errors atomically and never exposes a partial snapshot', () => {
    const sources = createValidSources();
    delete sources.characters.assets[0].propertyValues[FIELD_KEYS.characters.name];
    sources.skills.assets[0].propertyValues[FIELD_KEYS.skills.el] = 'Void';

    const result = importSimulationSnapshot({
      sourceProjectId: PROJECT_ID, sources, fieldMappings: createValidMappings(),
    });

    expect(result.ok).toBe(false);
    expect('snapshot' in result).toBe(false);
    expect(errorsFor(result)).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'characters', code: 'missing_value' }),
      expect.objectContaining({ role: 'skills', code: 'invalid_enum' }),
    ]));
  });

  it('still reports duplicate IDs when another field on the duplicate row is invalid', () => {
    const sources = createValidSources();
    sources.characters.assets.push(structuredClone(sources.characters.assets[0]));
    sources.characters.assets[1].id = 'duplicate-with-bad-stat';
    sources.characters.assets[1].propertyValues[FIELD_KEYS.characters.hp] = -1;

    const errors = errorsFor(importSimulationSnapshot({
      sourceProjectId: PROJECT_ID, sources, fieldMappings: createValidMappings(),
    }));

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid_range', field: 'Base HP' }),
      expect.objectContaining({ code: 'duplicate_id', field: 'Character ID' }),
    ]));
  });

  it('still reports duplicate rule indexes when another value on that row is invalid', () => {
    const sources = createValidSources();
    sources.level.assets[1].propertyValues[FIELD_KEYS.level.level] = 2;
    sources.level.assets[1].propertyValues[FIELD_KEYS.level.exp] = -1;

    const errors = errorsFor(importSimulationSnapshot({
      sourceProjectId: PROJECT_ID, sources, fieldMappings: createValidMappings(),
    }));

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid_range', field: 'EXP Required' }),
      expect.objectContaining({ code: 'duplicate_id', field: 'Level' }),
    ]));
  });

  it.each(['unmapped', 'empty'] as const)('normalizes an %s optional class to an empty string', (scenario) => {
    const sources = createValidSources();
    const mappings = createValidMappings();
    if (scenario === 'unmapped') delete mappings.characters.cls;
    else sources.characters.assets[0].propertyValues[FIELD_KEYS.characters.cls] = '';

    const result = importSimulationSnapshot({
      sourceProjectId: PROJECT_ID,
      sources,
      fieldMappings: mappings,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.catalog.characters[0].cls).toBe('');
  });
});

describe('Studio simulation source facade', () => {
  const listLibrariesMock = jest.mocked(listLibraries);
  const getSchemaMock = jest.mocked(getLibrarySchema);
  const getAssetsMock = jest.mocked(getLibraryAssetsWithProperties);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('validates project membership before loading any selected source', async () => {
    listLibrariesMock.mockResolvedValue([]);

    await expect(loadSimulationProjectSources(
      {} as never,
      PROJECT_ID,
      LIBRARY_IDS,
    )).rejects.toThrow('does not belong');
    expect(getSchemaMock).not.toHaveBeenCalled();
    expect(getAssetsMock).not.toHaveBeenCalled();
  });

  it('loads each unique selected library once and assembles sources by role', async () => {
    const sources = createValidSources();
    const ids = { ...LIBRARY_IDS, skills: LIBRARY_IDS.characters };
    const uniqueIds = [LIBRARY_IDS.characters, LIBRARY_IDS.level, LIBRARY_IDS.skillc];
    listLibrariesMock.mockResolvedValue(uniqueIds.map((id) => ({
      id,
      project_id: PROJECT_ID,
      folder_id: null,
      name: `Library ${id}`,
      description: null,
      created_at: '',
      updated_at: '',
      updated_by: null,
    })));
    getSchemaMock.mockImplementation(async (_supabase, id) => ({
      sections: [],
      properties: id === LIBRARY_IDS.characters
        ? sources.characters.properties
        : id === LIBRARY_IDS.level ? sources.level.properties : sources.skillc.properties,
    }));
    getAssetsMock.mockImplementation(async (_supabase, id) => (
      id === LIBRARY_IDS.characters
        ? sources.characters.assets
        : id === LIBRARY_IDS.level ? sources.level.assets : sources.skillc.assets
    ));

    const result = await loadSimulationProjectSources({} as never, PROJECT_ID, ids);

    expect(getSchemaMock).toHaveBeenCalledTimes(3);
    expect(getAssetsMock).toHaveBeenCalledTimes(3);
    expect(result.characters).toBe(result.skills);
    expect(result.level.libraryId).toBe(LIBRARY_IDS.level);
    expect(Object.isFrozen(result)).toBe(true);
  });
});
