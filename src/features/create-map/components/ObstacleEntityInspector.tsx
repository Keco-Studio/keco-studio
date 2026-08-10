import { CopyOutlined, DeleteOutlined } from '@ant-design/icons';
import type { LocalCollisionShape } from '../model/mapPlanSchema';
import type { ObstacleEntity } from '../model/mapSceneSchema';
import styles from '../CreateMapWorkbench.module.css';

type CollisionKind = LocalCollisionShape['shape'];

export function collisionForType(kind: CollisionKind): LocalCollisionShape {
  if (kind === 'circle') return { shape: 'circle', cx: 0, cy: -16, radius: 16 };
  if (kind === 'polygon') {
    return {
      shape: 'polygon',
      points: [{ x: -16, y: 0 }, { x: 16, y: 0 }, { x: 0, y: -24 }],
    };
  }
  return { shape: 'rectangle', x: -16, y: -32, width: 32, height: 32 };
}

type ObstacleEntityInspectorProps = {
  entity: ObstacleEntity;
  onMove: (position: ObstacleEntity['position']) => void;
  onTransform: (scale: number, rotation: number) => void;
  onZIndexChange: (zIndex: number) => void;
  onCollisionChange: (collision: LocalCollisionShape) => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

function finite(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ObstacleEntityInspector({
  entity,
  onMove,
  onTransform,
  onZIndexChange,
  onCollisionChange,
  onDuplicate,
  onDelete,
}: ObstacleEntityInspectorProps) {
  const rectangleCollision = entity.collision.shape === 'rectangle' ? entity.collision : null;
  const circleCollision = entity.collision.shape === 'circle' ? entity.collision : null;
  const polygonCollision = entity.collision.shape === 'polygon' ? entity.collision : null;
  const numberField = (
    label: string,
    value: number,
    update: (value: number) => void,
    options: { min?: number; step?: number } = {},
  ) => (
    <label className={styles.fieldLabel}>
      {label}
      <input
        className={styles.input}
        type="number"
        value={value}
        min={options.min}
        step={options.step}
        onChange={(event) => {
          const next = finite(event.target.value);
          if (next !== null) update(next);
        }}
      />
    </label>
  );

  return (
    <section className={styles.inspectorSection} aria-labelledby="obstacle-entity-heading">
      <div className={styles.sectionHeadingRow}>
        <h2 id="obstacle-entity-heading" className={styles.sectionTitleSmall}>Obstacle</h2>
        <span className={styles.shapeBadge}>{entity.source}</span>
      </div>
      <div className={styles.selectedAsset}>
        <span className={styles.objectThumbnail} aria-hidden />
        <span><strong>{entity.assetKey}</strong><small>{entity.id}</small></span>
      </div>

      <div className={styles.twoColumnFields}>
        {numberField('X', entity.position.x, (x) => onMove({ ...entity.position, x }))}
        {numberField('Y', entity.position.y, (y) => onMove({ ...entity.position, y }))}
        {numberField('Scale', entity.scale, (scale) => {
          if (scale > 0) onTransform(scale, entity.rotation);
        }, { min: 0.05, step: 0.05 })}
        {numberField('Rotation', entity.rotation, (rotation) => onTransform(entity.scale, rotation), { step: 1 })}
        {numberField('Z-index', entity.zIndex, (zIndex) => {
          if (Number.isInteger(zIndex)) onZIndexChange(zIndex);
        }, { step: 1 })}
      </div>

      <div className={styles.resourceInspector}>
        <h3>Local collision</h3>
        <label className={styles.fieldLabel}>
          Shape
          <select
            className={styles.select}
            value={entity.collision.shape}
            onChange={(event) => onCollisionChange(collisionForType(event.target.value as CollisionKind))}
          >
            <option value="rectangle">Rectangle</option>
            <option value="circle">Circle</option>
            <option value="polygon">Polygon</option>
          </select>
        </label>
        <div className={styles.twoColumnFields}>
          {rectangleCollision ? (
            <>
              {numberField('Local X', rectangleCollision.x, (x) => onCollisionChange({ ...rectangleCollision, x }))}
              {numberField('Local Y', rectangleCollision.y, (y) => onCollisionChange({ ...rectangleCollision, y }))}
              {numberField('Width', rectangleCollision.width, (width) => {
                if (width > 0) onCollisionChange({ ...rectangleCollision, width });
              }, { min: 1 })}
              {numberField('Height', rectangleCollision.height, (height) => {
                if (height > 0) onCollisionChange({ ...rectangleCollision, height });
              }, { min: 1 })}
            </>
          ) : null}
          {circleCollision ? (
            <>
              {numberField('Center X', circleCollision.cx, (cx) => onCollisionChange({ ...circleCollision, cx }))}
              {numberField('Center Y', circleCollision.cy, (cy) => onCollisionChange({ ...circleCollision, cy }))}
              {numberField('Radius', circleCollision.radius, (radius) => {
                if (radius > 0) onCollisionChange({ ...circleCollision, radius });
              }, { min: 1 })}
            </>
          ) : null}
        </div>
        {polygonCollision ? (
          <div className={styles.vertexList}>
            {polygonCollision.points.map((point, index) => (
              <div key={`${entity.id}-vertex-${index}`} className={styles.vertexRow}>
                <span>Vertex {index + 1}</span>
                <input
                  className={styles.input}
                  aria-label={`Vertex ${index + 1} X`}
                  type="number"
                  value={point.x}
                  onChange={(event) => {
                    const x = finite(event.target.value);
                    if (x === null) return;
                    onCollisionChange({
                      shape: 'polygon',
                      points: polygonCollision.points.map((candidate, candidateIndex) =>
                        candidateIndex === index ? { ...candidate, x } : candidate
                      ),
                    });
                  }}
                />
                <input
                  className={styles.input}
                  aria-label={`Vertex ${index + 1} Y`}
                  type="number"
                  value={point.y}
                  onChange={(event) => {
                    const y = finite(event.target.value);
                    if (y === null) return;
                    onCollisionChange({
                      shape: 'polygon',
                      points: polygonCollision.points.map((candidate, candidateIndex) =>
                        candidateIndex === index ? { ...candidate, y } : candidate
                      ),
                    });
                  }}
                />
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className={styles.anchorReadout}>
        Ground anchor <strong>{entity.groundAnchor.x}, {entity.groundAnchor.y}</strong>
      </div>
      <div className={styles.inlineActions}>
        <button type="button" className={styles.secondaryButton} onClick={onDuplicate}>
          <CopyOutlined aria-hidden /> Duplicate
        </button>
        <button type="button" className={styles.dangerButtonInline} onClick={onDelete}>
          <DeleteOutlined aria-hidden /> Delete
        </button>
      </div>
    </section>
  );
}
