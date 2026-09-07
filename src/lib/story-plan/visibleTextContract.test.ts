import { describe, expect, it } from '@jest/globals';
import { segmentStorySource } from './sourceSegments';
import {
  auditVisibleText,
  buildVisibleTextManifest,
  renderStoryDocumentVisibleText,
} from './visibleTextContract';
import type { StoryDocument } from '@/lib/story-ir/schema';

describe('visible story text contract', () => {
  it('inventories player-visible text exactly and excludes non-visible script metadata', () => {
    const source = segmentStorySource([
      '【Chapter One】',
      'Guide（whispers）：Welcome, traveler.',
      '（The door opens slowly）',
      'Choose a path.',
      'Branch 1: Choose [Enter the hall]',
      'The hall is quiet.',
    ].join('\n'), 'fixture');

    const manifest = buildVisibleTextManifest(source);

    expect(manifest.items.map((item) => item.text)).toEqual([
      'Guide',
      'Welcome, traveler.',
      'Choose a path.',
      'Enter the hall',
      'The hall is quiet.',
    ]);
    expect(manifest.items.every((item) => item.text === source.content.slice(item.start, item.end))).toBe(true);
    expect(manifest.items.every((item) => item.sourceText === source.content.slice(item.start, item.end))).toBe(true);
    expect(manifest.items.some((item) => item.text === 'Chapter One')).toBe(false);
  });

  it('accepts extensions but rejects omissions and any non-identical source text', () => {
    const source = segmentStorySource('Guide: Welcome, traveler.\nThe door opens.', 'fixture');
    const manifest = buildVisibleTextManifest(source);

    expect(auditVisibleText(manifest, [
      'Guide',
      'Welcome, traveler.',
      'An added line.',
      'The door opens.',
    ])).toEqual({ verdict: 'pass', issues: [] });

    const altered = auditVisibleText(manifest, ['Guide', 'Welcome traveler.', 'The door opens.']);
    expect(altered.verdict).toBe('fail');
    expect(altered.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'missing', text: 'Welcome, traveler.' }),
    ]));

    const omitted = auditVisibleText(manifest, ['Guide', 'Welcome, traveler.']);
    expect(omitted.verdict).toBe('fail');
    expect(omitted.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'missing', text: 'The door opens.' }),
    ]));
  });

  it('renders story documents into the same exact-text audit stream', () => {
    const document: StoryDocument = {
      version: 1,
      entryLabel: 'Start',
      nodes: [{
        label: 'Start',
        type: 'dialogue',
        speaker: 'Guide',
        content: 'Welcome, traveler.',
        commands: [],
        options: [{
          text: 'Enter the hall',
          target: 'End',
          commands: [],
          sourceRefs: [{ sourceId: 'fixture', unitId: 'fixture:0', start: 0, end: 1 }],
        }],
        sourceRefs: [{ sourceId: 'fixture', unitId: 'fixture:0', start: 0, end: 1 }],
      }],
    };

    expect(renderStoryDocumentVisibleText(document)).toEqual([
      'Guide',
      'Welcome, traveler.',
      'Enter the hall',
    ]);
  });
});
