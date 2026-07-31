'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { AssetRow } from '@/lib/types/libraryAssets';
import type { ScriptColumns } from '@/components/libraries/components/VisualNovelScriptView';
import { VisualNovelScriptView } from '@/components/libraries/components/VisualNovelScriptView';
import {
  clampSplitRatio,
  readSplitRatio,
  writeSplitRatio,
} from '@/lib/script-system/splitRatioStorage';
import { FlowChartPanel } from './FlowChartPanel';
import styles from './ScriptSplitView.module.css';

export type ScriptSplitViewProps = {
  libraryName: string;
  rows: AssetRow[];
  scriptColumns: ScriptColumns;
  flowRows: Array<Record<string, string>>;
};

const MIN_PANE_PX = 240;
const DIVIDER_WIDTH = 6;

export function ScriptSplitView({
  libraryName,
  rows,
  scriptColumns,
  flowRows,
}: ScriptSplitViewProps) {
  const [ratio, setRatio] = useState(() => readSplitRatio());
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const ratioRef = useRef(ratio);

  useEffect(() => {
    ratioRef.current = ratio;
  }, [ratio]);

  useEffect(() => {
    if (!dragging) return;

    const onMouseMove = (event: MouseEvent) => {
      const body = bodyRef.current;
      if (!body) return;
      const rect = body.getBoundingClientRect();
      const usable = rect.width - DIVIDER_WIDTH;
      if (usable <= 0) return;

      const minRatio = Math.max(MIN_PANE_PX / usable, 0.35);
      const maxRatio = Math.min(1 - MIN_PANE_PX / usable, 0.8);
      const next = (event.clientX - rect.left) / usable;
      const clamped = clampSplitRatio(
        Math.min(maxRatio, Math.max(minRatio, next))
      );
      ratioRef.current = clamped;
      setRatio(clamped);
    };

    const onMouseUp = () => {
      setDragging(false);
      writeSplitRatio(ratioRef.current);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragging]);

  const startDrag = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    setDragging(true);
  }, []);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <h1 className={styles.title}>{libraryName}</h1>
        {collapsed ? (
          <button
            type="button"
            className={styles.reopenButton}
            onClick={() => setCollapsed(false)}
          >
            Show Flow chart
          </button>
        ) : null}
      </header>

      <div
        ref={bodyRef}
        className={`${styles.body} ${dragging ? styles.dragging : ''}`}
      >
        <div
          className={styles.leftPane}
          style={
            collapsed
              ? { flex: '1 1 auto' }
              : { flex: `${ratio} 1 0%` }
          }
        >
          <VisualNovelScriptView rows={rows} scriptColumns={scriptColumns} />
        </div>

        {!collapsed ? (
          <>
            <div
              className={styles.divider}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize script panes"
              onMouseDown={startDrag}
            />
            <div
              className={styles.rightPane}
              style={{ flex: `${1 - ratio} 1 0%` }}
            >
              <FlowChartPanel
                rows={flowRows}
                onClose={() => setCollapsed(true)}
              />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
