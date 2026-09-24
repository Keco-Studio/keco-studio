'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import {
  AGENT_LAUNCHER_DRAG_THRESHOLD_PX,
  AGENT_LAUNCHER_SIZE,
  clampLauncherPosition,
  readStoredLauncherPosition,
  writeStoredLauncherPosition,
  type LauncherPosition,
} from './draggableLauncherPosition';

type DragSession = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  originLeft: number;
  originTop: number;
  moved: boolean;
};

export function useDraggableLauncherPosition() {
  const [position, setPosition] = useState<LauncherPosition | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const clearClickSuppression = useRef<(() => void) | null>(null);

  useEffect(() => () => clearClickSuppression.current?.(), []);

  useEffect(() => {
    const stored = readStoredLauncherPosition();
    if (!stored) return;
    setPosition(
      clampLauncherPosition(stored.left, stored.top, window.innerWidth, window.innerHeight),
    );
  }, []);

  useEffect(() => {
    const onResize = () => {
      setPosition((prev) => {
        if (!prev) return prev;
        const next = clampLauncherPosition(prev.left, prev.top, window.innerWidth, window.innerHeight);
        writeStoredLauncherPosition(next);
        return next;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    clearClickSuppression.current?.();
    if (event.button !== 0) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const session: DragSession = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originLeft: rect.left,
      originTop: rect.top,
      moved: false,
    };

    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== session.pointerId) return;
      const dx = moveEvent.clientX - session.startClientX;
      const dy = moveEvent.clientY - session.startClientY;
      if (!session.moved) {
        if (Math.hypot(dx, dy) < AGENT_LAUNCHER_DRAG_THRESHOLD_PX) return;
        session.moved = true;
        setIsDragging(true);
      }
      const next = clampLauncherPosition(
        session.originLeft + dx,
        session.originTop + dy,
        window.innerWidth,
        window.innerHeight,
      );
      setPosition(next);
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== session.pointerId) return;
      target.releasePointerCapture(session.pointerId);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);

      if (session.moved) {
        setPosition((prev) => {
          if (!prev) return prev;
          writeStoredLauncherPosition(prev);
          return prev;
        });
        setIsDragging(false);
        // Suppress only this gesture's synthetic click. Touch drags may emit no
        // click, so a new pointer gesture must clear the pending suppression.
        const clear = () => {
          window.removeEventListener('click', suppressClick, true);
          window.removeEventListener('pointerdown', clear, true);
          clearClickSuppression.current = null;
        };
        const suppressClick = (clickEvent: MouseEvent) => {
          clickEvent.preventDefault();
          clickEvent.stopPropagation();
          clear();
        };
        clearClickSuppression.current = clear;
        window.addEventListener('click', suppressClick, true);
        window.addEventListener('pointerdown', clear, true);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }, []);

  const style: CSSProperties | undefined = position
    ? {
        left: position.left,
        top: position.top,
        right: 'auto',
        bottom: 'auto',
      }
    : undefined;

  return {
    style,
    onPointerDown,
    isDragging,
    size: AGENT_LAUNCHER_SIZE,
  };
}
