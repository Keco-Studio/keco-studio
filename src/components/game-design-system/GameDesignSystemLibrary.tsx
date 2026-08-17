'use client';

import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { GameDesignSystem } from '@/lib/services/gameDesignSystemService';
import styles from './GameDesignSystemsPage.module.css';

export type GameDesignSystemScope = 'mine' | 'official';

type Props = {
  systems: GameDesignSystem[];
  scope: GameDesignSystemScope;
  search: string;
  selectedId: string | null;
  viewerUserId: string;
  loading: boolean;
  error: boolean;
  onScopeChange: (scope: GameDesignSystemScope) => void;
  onSearchChange: (value: string) => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRetry: () => void;
};

export function visibleGameDesignSystems(
  systems: GameDesignSystem[],
  scope: GameDesignSystemScope,
  viewerUserId: string,
  search: string,
): GameDesignSystem[] {
  const query = search.trim().toLowerCase();
  return systems.filter((system) => {
    if (scope === 'mine' && (system.source !== 'user' || system.owner_id !== viewerUserId)) return false;
    if (scope === 'official' && system.source !== 'official') return false;
    if (!query) return true;
    return [system.title, system.summary, ...system.genres, ...system.philosophies]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query);
  });
}

export function GameDesignSystemLibrary(props: Props) {
  const filtered = visibleGameDesignSystems(props.systems, props.scope, props.viewerUserId, props.search);
  const mineCount = props.systems.filter((system) => system.source === 'user' && system.owner_id === props.viewerUserId).length;
  const officialCount = props.systems.filter((system) => system.source === 'official').length;
  const emptyText = props.scope === 'official' && !props.search.trim()
    ? 'No official systems yet.'
    : props.scope === 'mine' && !props.search.trim()
      ? 'No personal systems yet.'
      : 'No systems match the current filters.';

  return (
    <aside className={styles.library} aria-label="Game Design System library">
      <div className={styles.libraryHeader}>
        <div>
          <span className={styles.eyebrow}>Design governance</span>
          <h1>Game Design System</h1>
        </div>
        <button
          className={styles.iconButton}
          type="button"
          aria-label="Create Game Design System"
          title="Create Game Design System"
          onClick={props.onCreate}
        >
          <PlusOutlined />
        </button>
      </div>

      <div className={styles.libraryScopes} role="tablist" aria-label="System source">
        <button type="button" role="tab" aria-selected={props.scope === 'mine'} className={props.scope === 'mine' ? styles.scopeTabActive : styles.scopeTab} onClick={() => props.onScopeChange('mine')}>
          My Systems <span>{mineCount}</span>
        </button>
        <button type="button" role="tab" aria-selected={props.scope === 'official'} className={props.scope === 'official' ? styles.scopeTabActive : styles.scopeTab} onClick={() => props.onScopeChange('official')}>
          Official <span>{officialCount}</span>
        </button>
      </div>

      <label className={styles.librarySearch}>
        <SearchOutlined aria-hidden="true" />
        <span className={styles.srOnly}>Search Game Design System</span>
        <input value={props.search} onChange={(event) => props.onSearchChange(event.target.value)} placeholder="Search systems" />
      </label>

      <div className={styles.libraryList}>
        {props.loading ? Array.from({ length: 5 }).map((_, index) => <div className={styles.skeleton} key={index} />) : null}
        {props.error ? (
          <div className={styles.libraryState}>
            <p>Failed to load systems.</p>
            <button className={styles.secondaryButton} type="button" onClick={props.onRetry}><ReloadOutlined /> Retry</button>
          </div>
        ) : null}
        {!props.loading && !props.error && filtered.length === 0 ? <div className={styles.libraryState}>{emptyText}</div> : null}
        {!props.loading && !props.error ? filtered.map((system) => (
          <button
            type="button"
            key={system.id}
            className={system.id === props.selectedId ? styles.libraryRowActive : styles.libraryRow}
            aria-pressed={system.id === props.selectedId}
            onClick={() => props.onSelect(system.id)}
          >
            <span className={styles.libraryRowTop}>
              <strong>{system.title}</strong>
              <span className={styles.statusDot} title={system.status} />
            </span>
            <span className={styles.libraryRowSummary}>{system.summary || 'No summary'}</span>
            <span className={styles.libraryRowMeta}>
              {system.current_version_id ? 'Versioned' : 'No version'}
              {system.genres[0] ? ' / ' + system.genres[0] : ''}
            </span>
          </button>
        )) : null}
      </div>
    </aside>
  );
}
