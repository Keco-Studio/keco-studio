import { describe, expect, it } from '@jest/globals';
import { compileGameArtStyle } from '@/lib/game-art-style/compiler';
import { parseGameDesignDocument, parseRuleSet } from './ruleSchema';
import { canonicalJsonEqual, createVersionDiff } from './versionDiff';

const document = parseGameDesignDocument({
  gameBackground: 'A flooded river kingdom rebuilds around ancient locks.',
  designIntent: 'Make every tactical choice legible before commitment.',
  playerFantasy: 'Lead a compact squad through recoverable risks.',
  coreLoop: 'Scout, commit, resolve, and adapt.',
  decisionStructure: 'Trade immediate safety for positional advantage.',
  systemBoundaries: 'Uncertainty may never conceal action costs.',
  progressionEconomy: 'New tools widen options without invalidating old ones.',
  contentModel: 'Combine objectives, terrain pressure, and enemy roles.',
  difficultyBalance: 'Increase decision pressure rather than raw statistics.',
  experiencePresentation: 'Show intent, costs, and state changes in context.',
});

const rules = parseRuleSet({
  schemaVersion: 1,
  genres: ['Strategy'],
  philosophies: ['Readable Systems'],
  suitableFor: 'Tactical games',
  rules: [{
    id: 'readable-state',
    kind: 'principle',
    title: 'Readable state',
    statement: 'Expose decision inputs.',
    appliesWhen: 'Presenting choices.',
    severity: 'required',
  }],
  tableGuidance: [],
});

const artStyle = compileGameArtStyle({
  presetId: 'pixel-art',
  presetVersion: 1,
  customization: {
    direction: 'Bright readable routes.',
    referenceGames: [{ name: 'Eastward', borrow: 'Material clusters' }],
    avoid: 'No horror.',
  },
});

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  document,
  rules,
  artStyle,
  ...overrides,
});

describe('canonicalJsonEqual', () => {
  it('sorts object keys recursively while retaining array order', () => {
    expect(canonicalJsonEqual(
      { outer: { second: 2, first: 1 }, list: ['a', 'b'] },
      { list: ['a', 'b'], outer: { first: 1, second: 2 } },
    )).toBe(true);
    expect(canonicalJsonEqual({ list: ['a', 'b'] }, { list: ['b', 'a'] })).toBe(false);
  });

  it.each([
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    BigInt(1),
    () => 'not JSON',
    Symbol('not JSON'),
    new Date('2026-08-18T00:00:00.000Z'),
  ])('rejects unsupported JavaScript values', (value) => {
    expect(() => canonicalJsonEqual(value, null)).toThrow(TypeError);
  });

  it('rejects sparse arrays even when a custom property balances the key count', () => {
    const sparse = new Array(1) as unknown[] & { extra?: boolean };
    sparse.extra = true;

    expect(() => canonicalJsonEqual(sparse, [null])).toThrow(TypeError);
  });
});

describe('createVersionDiff', () => {
  it('reports only the changed document sections in schema order', () => {
    const nextDocument = { ...document, gameBackground: 'A desert city surrounds a buried observatory.' };

    const diff = createVersionDiff(snapshot(), snapshot({ document: nextDocument }));

    expect(diff.document.changedSections).toEqual(['gameBackground']);
    expect(diff.ruleSetSettingsChanged).toBe(false);
    expect(diff.tableGuidanceChanged).toBe(false);
    expect(diff.artStyle.change).toBe('unchanged');
  });

  it('distinguishes document prose, rule settings, Table Guidance, and per-rule changes', () => {
    const nextRules = parseRuleSet({
      ...rules,
      genres: ['Strategy', 'Puzzle'],
      rules: [
        { ...rules.rules[0], statement: 'Expose costs and likely outcomes.' },
        { ...rules.rules[0], id: 'visible-costs', title: 'Visible costs' },
      ],
      tableGuidance: [{ table: 'Skills', purpose: 'Define reusable actions.', fields: ['name', 'cost'] }],
    });
    const diff = createVersionDiff(
      snapshot(),
      snapshot({ document: { ...document, coreLoop: 'Plan, act, inspect, and adapt.' }, rules: nextRules }),
    );

    expect(diff.document.changedSections).toEqual(['coreLoop']);
    expect(diff.ruleSetSettingsChanged).toBe(true);
    expect(diff.tableGuidanceChanged).toBe(true);
    expect(diff.added).toEqual(['visible-costs']);
    expect(diff.changed).toEqual(['readable-state']);
    expect(diff.conflicts).toEqual([]);
  });

  it('classifies Art Style changes by preset, revision, then customization priority', () => {
    const otherPreset = { ...artStyle, presetId: 'flat-graphic-2d', presetVersion: 2, customization: { ...artStyle.customization, direction: 'Flat shapes.' } };
    const unsupportedV2 = { ...artStyle, presetVersion: 2 };
    const unsupportedV3 = { ...artStyle, presetVersion: 3, customization: { ...artStyle.customization, direction: 'Changed too.' } };
    const customizedV2 = { ...unsupportedV2, customization: { ...artStyle.customization, direction: 'Sharper clusters.' } };

    expect(createVersionDiff(snapshot(), snapshot({ artStyle: otherPreset })).artStyle.change).toBe('preset_changed');
    expect(createVersionDiff(snapshot({ artStyle: unsupportedV2 }), snapshot({ artStyle: unsupportedV3 })).artStyle.change)
      .toBe('preset_version_changed');
    expect(createVersionDiff(snapshot({ artStyle: unsupportedV2 }), snapshot({ artStyle: customizedV2 })).artStyle.change)
      .toBe('customization_changed');
  });

  it('handles added, removed, unchanged, and unsupported raw Art Style values without exposing them', () => {
    const unsupported = { presetId: 'future-style', presetVersion: 9, raw: { z: 2, a: 1 } };
    const reorderedUnsupported = { raw: { a: 1, z: 2 }, presetVersion: 9, presetId: 'future-style' };

    expect(createVersionDiff(snapshot({ artStyle: null }), snapshot()).artStyle.change).toBe('added');
    expect(createVersionDiff(snapshot(), snapshot({ artStyle: null })).artStyle.change).toBe('removed');
    expect(createVersionDiff(snapshot({ artStyle: unsupported }), snapshot({ artStyle: reorderedUnsupported })).artStyle.change)
      .toBe('unchanged');
    expect(createVersionDiff(snapshot({ artStyle: unsupported }), snapshot()).artStyle.change).toBe('preset_changed');
    expect(createVersionDiff(snapshot({ artStyle: unsupported }), snapshot({ artStyle: null })).artStyle.change).toBe('removed');
  });
});
