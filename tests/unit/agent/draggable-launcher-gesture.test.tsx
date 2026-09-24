/** @jest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useDraggableLauncherPosition } from '@/components/agent/useDraggableLauncherPosition';

function Launcher({ onClick }: { onClick: () => void }) {
  const { onPointerDown, style } = useDraggableLauncherPosition();
  return <button onPointerDown={onPointerDown} onClick={onClick} style={style}>Assistant</button>;
}

function pointer(target: HTMLElement | Window, type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  fireEvent(target, event);
  return event;
}

function drag(button: HTMLElement) {
  button.setPointerCapture = jest.fn();
  button.releasePointerCapture = jest.fn();
  pointer(button, 'pointerdown', 20, 20);
  pointer(window, 'pointermove', 80, 80);
  return pointer(window, 'pointerup', 80, 80);
}

afterEach(() => { cleanup(); localStorage.clear(); });

it('suppresses the current drag click but permits the first click in the next pointer gesture', () => {
  const onClick = jest.fn();
  const { getByRole } = render(<Launcher onClick={onClick} />);
  const button = getByRole('button');
  expect(drag(button).defaultPrevented).toBe(false);
  fireEvent.click(button);
  expect(onClick).not.toHaveBeenCalled();
  drag(button); // A touch drag may not produce any synthetic click.
  pointer(button, 'pointerdown', 80, 80);
  pointer(window, 'pointerup', 80, 80);
  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledTimes(1);
});

it('removes a pending drag click blocker when the launcher unmounts', () => {
  const { getByRole, unmount } = render(<Launcher onClick={jest.fn()} />);
  drag(getByRole('button'));
  unmount();
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  expect(window.dispatchEvent(click)).toBe(true);
  expect(click.defaultPrevented).toBe(false);
});
