'use client';

import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useMemo, useState } from 'react';
import type { SavedMapSummary } from '../services/createMapService';
import styles from '../CreateMapWorkbench.module.css';

type SavedMapsPanelProps = {
  maps: SavedMapSummary[];
  isLoading: boolean;
  error: string | null;
  activeMapId: string | null;
  openingMapId: string | null;
  disabled: boolean;
  projectId?: string;
  onOpen: (map: SavedMapSummary) => void;
  onRetry: () => void;
  onCreate?: () => void;
  readOnly?: boolean;
};

const dateTime = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function SavedMapsPanel(props: SavedMapsPanelProps) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const scoped = props.projectId
      ? props.maps.filter((map) => map.projectId === props.projectId)
      : props.maps;
    const needle = query.trim().toLowerCase();
    if (!needle) return scoped;
    return scoped.filter((map) => (
      map.name.toLowerCase().includes(needle)
      || map.projectName.toLowerCase().includes(needle)
    ));
  }, [props.maps, props.projectId, query]);

  return (
    <section className={styles.savedMapsSection} aria-labelledby="saved-maps-heading">
      <div className={styles.savedMapsHeadingRow}>
        <h2 id="saved-maps-heading" className={styles.savedMapsHeading}>Saved maps</h2>
        <button
          type="button"
          className={styles.savedMapsAddButton}
          aria-label="Create map"
          title="Create map"
          disabled={props.disabled || props.readOnly || !props.onCreate}
          onClick={props.onCreate}
        >
          <PlusOutlined />
        </button>
      </div>

      <label className={styles.savedMapsSearch}>
        <SearchOutlined aria-hidden />
        <input
          type="search"
          placeholder="Search"
          aria-label="Search saved maps"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

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
      {!props.isLoading && !props.error && filtered.length === 0
        ? <p className={styles.savedMapsState}>No saved maps</p>
        : null}

      {filtered.length > 0 ? (
        <ul className={styles.savedMapsList}>
          {filtered.map((map) => {
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
                    <span className={styles.savedMapTitleRow}>
                      <strong>{map.name}</strong>
                      <span className={styles.versionTag}>v{map.schemaVersion}</span>
                    </span>
                    {opening ? (
                      <span className={styles.savedMapMeta}>Opening...</span>
                    ) : (
                      <time className={styles.savedMapMeta} dateTime={map.updatedAt}>
                        {dateTime.format(new Date(map.updatedAt))}
                      </time>
                    )}
                    <small className={styles.savedMapDescription}>{map.projectName}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
