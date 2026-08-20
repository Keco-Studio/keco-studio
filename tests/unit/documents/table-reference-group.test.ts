/** @jest-environment jsdom */

import { findTableReferenceGroup } from '@/components/documents/useTableReferenceGroup';

function reference(key: string, libraryId = 'library-a'): string {
  return [
    '<span',
    ' data-resource-reference-kind="table-row"',
    ` data-resource-reference-key="${key}"`,
    ` data-resource-reference-library-id="${libraryId}"`,
    `><a>Products</a><span>row ${key}</span></span>`,
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

  it('never groups references when prose paragraphs separate them', () => {
    document.body.innerHTML = [
      `<p>${reference('first')}</p>`,
      '<p>explanatory prose</p>',
      `<p>${reference('second')}</p>`,
    ].join('\n');

    expect(markedReferences().map((element) =>
      findTableReferenceGroup(element).keys
    )).toEqual([['first'], ['second']]);
  });

  it('groups adjacent reference-only paragraphs that share a library', () => {
    document.body.innerHTML = [
      `<p>${reference('first')}</p>`,
      `<p>${reference('second')}</p>`,
      `<p>${reference('third')}</p>`,
    ].join('\n');
    const [first, second, third] = markedReferences();

    expect(findTableReferenceGroup(first!)).toEqual({
      isPrimary: true,
      keys: ['first', 'second', 'third'],
    });
    expect(findTableReferenceGroup(second!)).toEqual({
      isPrimary: false,
      keys: ['first', 'second', 'third'],
    });
    expect(findTableReferenceGroup(third!)).toEqual({
      isPrimary: false,
      keys: ['first', 'second', 'third'],
    });
  });

  it('groups Lexical-style decorator wrappers that are not paragraph blocks', () => {
    document.body.innerHTML = [
      '<div contenteditable="true">',
      `<div data-lexical-decorator="true">${reference('first')}</div>`,
      `<div data-lexical-decorator="true">${reference('second')}</div>`,
      `<div data-lexical-decorator="true">${reference('third')}</div>`,
      '</div>',
    ].join('');
    const [first, second, third] = markedReferences();

    expect(findTableReferenceGroup(first!)).toEqual({
      isPrimary: true,
      keys: ['first', 'second', 'third'],
    });
    expect(findTableReferenceGroup(second!).isPrimary).toBe(false);
    expect(findTableReferenceGroup(third!).keys).toEqual(['first', 'second', 'third']);
  });

  it('does not cross-group different libraries', () => {
    document.body.innerHTML = [
      `<div data-lexical-decorator="true">${reference('first', 'library-a')}</div>`,
      `<div data-lexical-decorator="true">${reference('second', 'library-b')}</div>`,
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
