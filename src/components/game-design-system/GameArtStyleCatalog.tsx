'use client';

import { useRef, type KeyboardEvent } from 'react';
import { gameArtStyleKey, type GAME_ART_STYLE_CATALOG } from '@/lib/game-art-style/presets';
import styles from './GameDesignSystemsPage.module.css';

type Props = {
  catalog: readonly (typeof GAME_ART_STYLE_CATALOG)[number][];
  selectedKey: string;
  onSelect: (key: string) => void;
};

export function GameArtStyleCatalog({ catalog, selectedKey, onSelect }: Props) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = catalog.findIndex((preset) => gameArtStyleKey(preset.presetId, preset.presetVersion) === selectedKey);

  function handleKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | null = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % catalog.length;
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index - 1 + catalog.length) % catalog.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = catalog.length - 1;
    if (next === null) return;
    event.preventDefault();
    const preset = catalog[next];
    onSelect(gameArtStyleKey(preset.presetId, preset.presetVersion));
    refs.current[next]?.focus();
  }

  return (
    <div className={styles.artStyleCatalogOptions} role="radiogroup" aria-label="Art style catalog">
      {catalog.map((preset, index) => {
        const key = gameArtStyleKey(preset.presetId, preset.presetVersion);
        const selected = key === selectedKey;
        return <button
          ref={(element) => { refs.current[index] = element; }}
          className={selected ? styles.artStyleCatalogOptionActive : styles.artStyleCatalogOption}
          type="button"
          role="radio"
          aria-checked={selected}
          tabIndex={selected || (selectedIndex < 0 && index === 0) ? 0 : -1}
          key={key}
          onClick={() => onSelect(key)}
          onKeyDown={(event) => handleKey(event, index)}
        >
          <span className={styles.artStyleCatalogSwatch} style={{ backgroundImage: `url(${preset.previewAssetSet.map.publicPath})` }} aria-hidden="true" />
          <span><strong>{preset.title}</strong><small>Official preset / Revision {preset.presetVersion}</small></span>
        </button>;
      })}
    </div>
  );
}
