import { ReloadOutlined } from '@ant-design/icons';
import type { SavedMapSummary } from '../services/createMapService';
import styles from '../CreateMapWorkbench.module.css';

type SavedMapsPanelProps = {
  maps: SavedMapSummary[];
  isLoading: boolean;
  error: string | null;
  activeMapId: string | null;
  openingMapId: string | null;
  disabled: boolean;
  onOpen: (map: SavedMapSummary) => void;
  onRetry: () => void;
};

const dateTime = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function SavedMapsPanel(props: SavedMapsPanelProps) {
  return (
    <section className={styles.panelSection} aria-labelledby="saved-maps-heading">
      <div className={styles.sectionHeadingRow}>
        <h2 id="saved-maps-heading" className={styles.sectionTitleSmall}>Saved Maps</h2>
        <span className={styles.itemMeta}>{props.maps.length}</span>
      </div>
      {props.isLoading ? <p className={styles.savedMapsState}>Loading maps...</p> : null}
      {props.error ? (
        <div className={styles.savedMapsState} role="alert">
          <span>{props.error}</span>
          <button
            type="button"
            className={styles.miniIconButton}
            aria-label="Retry saved maps"
            title="Retry saved maps"
            onClick={props.onRetry}
          >
            <ReloadOutlined />
          </button>
        </div>
      ) : null}
      {!props.isLoading && !props.error && props.maps.length === 0
        ? <p className={styles.savedMapsState}>No saved maps</p>
        : null}
      {props.maps.length > 0 ? (
        <ul className={styles.savedMapsList}>
          {props.maps.map((map) => {
            const active = map.id === props.activeMapId;
            const opening = map.id === props.openingMapId;
            return (
              <li key={map.id}>
                <button
                  type="button"
                  className={active ? styles.savedMapButtonActive : styles.savedMapButton}
                  aria-current={active || undefined}
                  aria-busy={opening || undefined}
                  disabled={props.disabled || opening}
                  onClick={() => props.onOpen(map)}
                >
                  <span className={styles.savedMapCopy}>
                    <strong>{map.name}</strong>
                    <small>{map.projectName}</small>
                  </span>
                  {opening ? (
                    <span className={styles.savedMapMeta}>Opening...</span>
                  ) : (
                    <time className={styles.savedMapMeta} dateTime={map.updatedAt}>
                      {dateTime.format(new Date(map.updatedAt))}
                    </time>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
