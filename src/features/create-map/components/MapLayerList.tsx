import { EyeInvisibleOutlined, EyeOutlined, LockOutlined } from '@ant-design/icons';
import type { MapSceneV2 } from '../model/mapSceneSchema';
import type { EditorSelection } from '../model/mapSceneReducer';
import styles from '../CreateMapWorkbench.module.css';

type MapLayerListProps = {
  scene: MapSceneV2;
  selection: EditorSelection;
  onSelect: (selection: EditorSelection) => void;
  onVisibilityChange: (layerId: string, visible: boolean) => void;
};

export function MapLayerList({
  scene,
  selection,
  onSelect,
  onVisibilityChange,
}: MapLayerListProps) {
  return (
    <section className={`${styles.panelSection} ${styles.layerSection}`} aria-labelledby="map-layers-heading">
      <div className={styles.sectionHeadingRow}>
        <h2 id="map-layers-heading" className={styles.sectionTitleSmall}>Scene layers</h2>
        <span className={styles.itemMeta}>{scene.obstacleEntities.length} obstacles</span>
      </div>
      <ul className={styles.contentList} aria-label="Scene layers">
        {scene.layers.map((layer) => (
          <li
            key={layer.id}
            className={selection?.kind === 'layer' && selection.id === layer.id
              ? styles.contentItemSelected
              : styles.contentItem}
          >
            <button
              type="button"
              className={styles.itemName}
              aria-pressed={selection?.kind === 'layer' && selection.id === layer.id}
              onClick={() => onSelect({ kind: 'layer', id: layer.id })}
            >
              <span className={styles.layerSwatch} data-kind={layer.kind} aria-hidden />
              <span>{layer.name}</span>
            </button>
            <div className={styles.rowActions}>
              {layer.locked ? <LockOutlined className={styles.lockIcon} aria-label={`${layer.name} locked`} /> : null}
              <button
                type="button"
                className={styles.miniIconButton}
                aria-label={`${layer.visible ? 'Hide' : 'Show'} ${layer.name}`}
                title={layer.visible ? 'Hide layer' : 'Show layer'}
                onClick={() => onVisibilityChange(layer.id, !layer.visible)}
              >
                {layer.visible ? <EyeOutlined /> : <EyeInvisibleOutlined />}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className={styles.subsectionHeading}>
        <h3>Obstacle entities</h3>
      </div>
      {scene.obstacleEntities.length > 0 ? (
        <ul className={styles.contentList} aria-label="Obstacle entities">
          {[...scene.obstacleEntities]
            .sort((left, right) => right.zIndex - left.zIndex || left.id.localeCompare(right.id))
            .map((entity) => (
              <li
                key={entity.id}
                className={selection?.kind === 'entity' && selection.id === entity.id
                  ? styles.contentItemSelected
                  : styles.contentItem}
              >
                <button
                  type="button"
                  className={styles.itemName}
                  aria-pressed={selection?.kind === 'entity' && selection.id === entity.id}
                  onClick={() => onSelect({ kind: 'entity', id: entity.id })}
                >
                  <span className={styles.objectThumbnail} aria-hidden />
                  <span>{entity.assetKey}</span>
                </button>
                <span className={styles.itemMeta}>z {entity.zIndex}</span>
              </li>
            ))}
        </ul>
      ) : (
        <p className={styles.emptyState}>No ready obstacles</p>
      )}
    </section>
  );
}
