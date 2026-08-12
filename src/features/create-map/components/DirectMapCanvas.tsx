import { useCallback, useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { DirectMapCollisionCell, DirectMapCollisionGrid } from '../model/directMapCollisionGrid';
import type { MapPlanV3, MapSceneV3 } from '../model/directMapSchema';
import styles from '../CreateMapWorkbench.module.css';

export type DirectMapCanvasImage = {
  sourceRevisionId: string;
  sha256: string;
  signedUrl: string;
  width: number;
  height: number;
};

type DirectMapCanvasProps = {
  plan: MapPlanV3;
  scene: MapSceneV3;
  image: DirectMapCanvasImage | null;
  collisionGrid?: DirectMapCollisionGrid | null;
  collisionVisible?: boolean;
  paintMode?: DirectMapCollisionCell;
  onPaintCell?: (column: number, row: number, value: DirectMapCollisionCell) => void;
};

export function DirectMapCanvas({
  plan,
  scene,
  image,
  collisionGrid = null,
  collisionVisible = false,
  paintMode = 1,
  onPaintCell,
}: DirectMapCanvasProps) {
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const lastPaintedCell = useRef<number | null>(null);
  const mapImage = scene.mapImage;
  const exactImage = mapImage
    && image
    && image.sourceRevisionId === mapImage.sourceRevisionId
    && image.width === mapImage.width
    && image.height === mapImage.height
    && image.width === plan.map.width
    && image.height === plan.map.height
    ? image
    : null;
  const imageBinding = exactImage
    ? `${exactImage.sourceRevisionId}:${exactImage.sha256}:${exactImage.signedUrl}`
    : '';
  const frameStyle = {
    '--direct-map-aspect': `${plan.map.width} / ${plan.map.height}`,
  } as CSSProperties;
  const orientation = plan.map.width === plan.map.height
    ? 'square'
    : plan.map.width > plan.map.height ? 'landscape' : 'portrait';
  const exactGrid = exactImage
    && collisionGrid
    && collisionGrid.imageSha256 === exactImage.sha256
    && collisionGrid.columns * collisionGrid.cellSize === exactImage.width
    && collisionGrid.rows * collisionGrid.cellSize === exactImage.height
    ? collisionGrid
    : null;

  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!collisionVisible || !exactGrid) return;

    exactGrid.cells.forEach((cell, index) => {
      if (cell === 0) return;
      const column = index % exactGrid.columns;
      const row = Math.floor(index / exactGrid.columns);
      context.fillStyle = 'rgba(194, 48, 48, 0.44)';
      context.fillRect(
        column * exactGrid.cellSize,
        row * exactGrid.cellSize,
        exactGrid.cellSize,
        exactGrid.cellSize,
      );
    });
    context.beginPath();
    context.strokeStyle = 'rgba(255, 255, 255, 0.24)';
    context.lineWidth = 0.5;
    for (let column = 1; column < exactGrid.columns; column += 1) {
      const x = column * exactGrid.cellSize;
      context.moveTo(x, 0);
      context.lineTo(x, canvas.height);
    }
    for (let row = 1; row < exactGrid.rows; row += 1) {
      const y = row * exactGrid.cellSize;
      context.moveTo(0, y);
      context.lineTo(canvas.width, y);
    }
    context.stroke();
  }, [collisionVisible, exactGrid]);

  const paintFromPointer = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!exactGrid || !onPaintCell) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const column = Math.min(
      exactGrid.columns - 1,
      Math.max(0, Math.floor(((event.clientX - bounds.left) / bounds.width) * exactGrid.columns)),
    );
    const row = Math.min(
      exactGrid.rows - 1,
      Math.max(0, Math.floor(((event.clientY - bounds.top) / bounds.height) * exactGrid.rows)),
    );
    const index = row * exactGrid.columns + column;
    if (lastPaintedCell.current === index) return;
    lastPaintedCell.current = index;
    onPaintCell(column, row, paintMode);
  }, [exactGrid, onPaintCell, paintMode]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    lastPaintedCell.current = null;
    paintFromPointer(event);
  }, [paintFromPointer]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    paintFromPointer(event);
  }, [paintFromPointer]);

  const finishPainting = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    lastPaintedCell.current = null;
  }, []);

  return (
    <div className={styles.directCanvasViewport}>
      <div
        className={styles.directCanvasFrame}
        style={frameStyle}
        data-orientation={orientation}
        data-image-binding={imageBinding}
      >
        {exactImage ? (
          // Signed private images must bypass the Next image proxy and preserve exact pixels.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={imageBinding}
            className={styles.directMapImage}
            src={exactImage.signedUrl}
            alt={plan.name}
            width={plan.map.width}
            height={plan.map.height}
          />
        ) : (
          <div className={styles.directCanvasEmpty}>
            <span>Map preview</span>
            <strong>{plan.map.width} × {plan.map.height}</strong>
          </div>
        )}
        {exactImage && exactGrid ? (
          <canvas
            ref={overlayRef}
            className={styles.directCollisionOverlay}
            data-visible={collisionVisible}
            width={plan.map.width}
            height={plan.map.height}
            aria-label="Editable collision grid"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishPainting}
            onPointerCancel={finishPainting}
          />
        ) : null}
      </div>
    </div>
  );
}
