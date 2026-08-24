/**
 * @jest-environment jsdom
 */
import {
  focusRenameInputAtEnd,
  resetSidebarHorizontalScroll,
} from '@/components/layout/sidebarScrollReset';

describe('sidebarScrollReset', () => {
  it('scrolls only the rename input to the end and clears parent horizontal scroll', () => {
    const parent = document.createElement('div');
    Object.defineProperty(parent, 'scrollLeft', { value: 40, writable: true, configurable: true });

    const input = document.createElement('input');
    input.value = 'a-very-long-sidebar-name-that-overflows';
    Object.defineProperty(input, 'scrollWidth', { value: 400, configurable: true });
    Object.defineProperty(input, 'clientWidth', { value: 120, configurable: true });
    Object.defineProperty(input, 'scrollLeft', { value: 0, writable: true, configurable: true });
    input.focus = jest.fn();
    input.setSelectionRange = jest.fn();

    parent.appendChild(input);
    document.body.appendChild(parent);

    focusRenameInputAtEnd(input);

    expect(input.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(input.setSelectionRange).toHaveBeenCalledWith(input.value.length, input.value.length);
    expect(input.scrollLeft).toBe(280);
    expect(parent.scrollLeft).toBe(0);

    parent.remove();
  });

  it('can reset ancestor scroll while preserving the rename input scroll', () => {
    const parent = document.createElement('div');
    Object.defineProperty(parent, 'scrollLeft', { value: 22, writable: true, configurable: true });

    const input = document.createElement('input');
    Object.defineProperty(input, 'scrollLeft', { value: 90, writable: true, configurable: true });
    parent.appendChild(input);

    resetSidebarHorizontalScroll(input, { preserve: input });

    expect(parent.scrollLeft).toBe(0);
    expect(input.scrollLeft).toBe(90);
  });
});
