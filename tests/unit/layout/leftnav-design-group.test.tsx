/** @jest-environment jsdom */

import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';

let mockPathname = '/projects';

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => React.createElement('img', props),
}));

import { LeftNav } from '@/components/layout/LeftNav';

describe('LeftNav Design group', () => {
  beforeEach(() => {
    mockPathname = '/projects';
    window.localStorage.clear();
  });

  it('keeps design tools hidden until the Design group is expanded', () => {
    render(<LeftNav />);

    expect(screen.getByRole('button', { name: 'Library' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Simulator' })).toBeNull();

    const designButton = screen.getByRole('button', { name: 'Design' });
    expect(designButton.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(designButton);

    expect(designButton.getAttribute('aria-expanded')).toBe('true');
    const designGroup = screen.getByRole('group', { name: 'Design tools' });
    const childLabels = within(designGroup)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'));
    expect(childLabels).toEqual(['Simulator', 'Script', 'Map', 'System']);

    fireEvent.click(designButton);
    expect(screen.queryByRole('group', { name: 'Design tools' })).toBeNull();
    expect(designButton.getAttribute('aria-controls')).toBeNull();
  });

  it('centers the disclosure mark below the Design pen icon', () => {
    const css = readFileSync(
      path.join(process.cwd(), 'src/components/layout/LeftNav.module.css'),
      'utf8',
    );
    const disclosureRule = css.match(/\.disclosure\s*\{[^}]+\}/)?.[0];
    const expandedRule = css.match(/\.disclosureExpanded\s*\{[^}]+\}/)?.[0];
    expect(disclosureRule).toBeTruthy();
    expect(expandedRule).toBeTruthy();

    const style = document.createElement('style');
    style.textContent = `${disclosureRule}\n${expandedRule}`;
    document.head.append(style);

    const disclosure = document.createElement('svg');
    disclosure.classList.add('disclosure');
    document.body.append(disclosure);

    const collapsedStyle = window.getComputedStyle(disclosure);
    expect(collapsedStyle.left).toBe('50%');
    expect(collapsedStyle.transform).toContain('translateX(-50%)');

    disclosure.classList.add('disclosureExpanded');
    expect(window.getComputedStyle(disclosure).transform).toBe(
      'translateX(-50%) rotate(90deg)',
    );

    disclosure.remove();
    style.remove();
  });

  it.each([
    ['/simulation-system', 'Simulator'],
    ['/script-system/project-1', 'Script'],
    ['/create-map', 'Map'],
    ['/game-design-systems', 'System'],
  ])('starts expanded and marks %s as the current Design tool', (pathname, label) => {
    mockPathname = pathname;

    render(<LeftNav />);

    expect(screen.getByRole('button', { name: 'Design' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: label }).getAttribute('aria-current')).toBe('page');
  });

  it('reopens when navigation moves between Design routes', () => {
    mockPathname = '/create-map';
    const { rerender } = render(<LeftNav />);
    const designButton = screen.getByRole('button', { name: 'Design' });

    fireEvent.click(designButton);
    expect(designButton.getAttribute('aria-expanded')).toBe('false');

    mockPathname = '/script-system/project-1';
    rerender(<LeftNav />);

    expect(screen.getByRole('button', { name: 'Design' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Script' }).getAttribute('aria-current')).toBe('page');
  });

  it('reopens when returning to the same Design route', () => {
    mockPathname = '/create-map';
    const { rerender } = render(<LeftNav />);
    const designButton = screen.getByRole('button', { name: 'Design' });

    fireEvent.click(designButton);
    expect(designButton.getAttribute('aria-expanded')).toBe('false');

    mockPathname = '/projects';
    rerender(<LeftNav />);
    mockPathname = '/create-map';
    rerender(<LeftNav />);

    expect(screen.getByRole('button', { name: 'Design' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Map' }).getAttribute('aria-current')).toBe('page');
  });
});
