import { useCallback, useState } from 'react';
import type { ProjectileKind } from './skillFxProfile';

export type MapFloatText = {
  id: string;
  target: 'player' | 'enemy';
  text: string;
  variant: 'damage' | 'heal' | 'exp' | 'proficiency';
  offsetX: number;
};

export type MapMoveFx = {
  id: string;
  target: 'player' | 'enemy';
  x: number;
  y: number;
};

export type MapProjectileFx = {
  id: string;
  kind: ProjectileKind;
  from: 'player' | 'enemy';
  startX: number;
  startY: number;
  deltaX: number;
  deltaY: number;
  durationMs: number;
};

export type MapImpactFx = {
  id: string;
  kind: 'hit' | 'dodge';
  target: 'player' | 'enemy';
  x: number;
  y: number;
};

const createFxId = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export function useMapTransientFx() {
  const [floatTexts, setFloatTexts] = useState<MapFloatText[]>([]);
  const [moveFx, setMoveFx] = useState<MapMoveFx[]>([]);
  const [projectileFx, setProjectileFx] = useState<MapProjectileFx[]>([]);
  const [impactFx, setImpactFx] = useState<MapImpactFx[]>([]);

  const clearTransientFx = useCallback(() => {
    setFloatTexts([]);
    setMoveFx([]);
    setProjectileFx([]);
    setImpactFx([]);
  }, []);

  const pushFloatText = useCallback((item: Omit<MapFloatText, 'id'>) => {
    const id = createFxId();
    setFloatTexts((prev) => [...prev, { ...item, id }]);
    window.setTimeout(() => {
      setFloatTexts((prev) => prev.filter((h) => h.id !== id));
    }, 1050);
  }, []);

  const pushMoveFx = useCallback((item: Omit<MapMoveFx, 'id'>) => {
    const id = createFxId();
    setMoveFx((prev) => [...prev, { ...item, id }]);
    window.setTimeout(() => {
      setMoveFx((prev) => prev.filter((h) => h.id !== id));
    }, 380);
  }, []);

  const pushProjectileFx = useCallback((item: Omit<MapProjectileFx, 'id'>) => {
    const id = createFxId();
    setProjectileFx((prev) => [...prev, { ...item, id }]);
    window.setTimeout(() => {
      setProjectileFx((prev) => prev.filter((h) => h.id !== id));
    }, item.durationMs + 80);
    return id;
  }, []);

  const pushImpactFx = useCallback((item: Omit<MapImpactFx, 'id'>) => {
    const id = createFxId();
    setImpactFx((prev) => [...prev, { ...item, id }]);
    window.setTimeout(() => {
      setImpactFx((prev) => prev.filter((h) => h.id !== id));
    }, item.kind === 'dodge' ? 420 : 320);
  }, []);

  return {
    floatTexts,
    moveFx,
    projectileFx,
    impactFx,
    clearTransientFx,
    pushFloatText,
    pushMoveFx,
    pushProjectileFx,
    pushImpactFx,
  };
}
