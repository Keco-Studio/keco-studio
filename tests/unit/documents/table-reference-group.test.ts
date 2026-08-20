/** @jest-environment jsdom */

import { findTableReferenceGroup } from '@/components/documents/useTableReferenceGroup';

function reference(key: string, libraryId = 'library-a'): string {
  return [
    '<span',
    ' data-resource-reference-kind="table-row"',
    ` data-resource-reference-key="${key}"`,
    ` data-resource-reference-library-id="${libraryId}"`,
    '></span>',
  ].join('');
}

function markedReferences(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(
    '[data-resource-reference-kind="table-row"]'
  )];
}

describe('findTableReferenceGroup', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('groups whitespace-separated same-library references in DOM order', () => {
    document.body.innerHTML = `<p>${reference('first')} \u200b\n ${reference('second')}</p>`;
    const [first, second] = markedReferences();

    expect(findTableReferenceGroup(first!)).toEqual({
      isPrimary: true,
      keys: ['first', 'second'],
    });
    expect(findTableReferenceGroup(second!)).toEqual({
      isPrimary: false,
      keys: ['first', 'second'],
    });
  });

  it('keeps duplicate keys as separate occurrences', () => {
    document.body.innerHTML = `<p>${reference('same')} ${reference('same')}</p>`;

    expect(findTableReferenceGroup(markedReferences()[0]!)).toEqual({
      isPrimary: true,
      keys: ['same', 'same'],
    });
  });

  it('splits groups at prose, line breaks, and different libraries', () => {
    document.body.innerHTML = [
      '<p>',
      reference('first'),
      ' explanatory text ',
      reference('second'),
      '<br>',
      reference('third'),
      ' ',
      reference('fourth', 'library-b'),
      '</p>',
    ].join('');

    expect(markedReferences().map((element) =>
      findTableReferenceGroup(element).keys
    )).toEqual([
      ['first'],
      ['second'],
      ['third'],
      ['fourth'],
    ]);
  });

  it('never groups references from different document blocks', () => {
    document.body.innerHTML = [
      `<p>${reference('first')}</p>`,
      `<p>${reference('second')}</p>`,
    ].join('\n');

    expect(markedReferences().map((element) =>
      findTableReferenceGroup(element).keys
    )).toEqual([['first'], ['second']]);
  });

  it('promotes the next occurrence after the first is removed', () => {
    document.body.innerHTML = `<p>${reference('first')} ${reference('second')}</p>`;
    const [first, second] = markedReferences();

    first!.remove();

    expect(findTableReferenceGroup(second!)).toEqual({
      isPrimary: true,
      keys: ['second'],
    });
  });
});
