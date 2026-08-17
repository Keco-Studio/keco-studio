'use client';

import Image from 'next/image';
import { useState } from 'react';
import type { GAME_ART_STYLE_CATALOG } from '@/lib/game-art-style/presets';
import styles from './GameDesignSystemsPage.module.css';

type CatalogPreset = (typeof GAME_ART_STYLE_CATALOG)[number];
type PreviewKey = 'map' | 'character';

const specificationSections = [
  ['visualIdentity', 'Visual identity'],
  ['pixelTechnique', 'Pixel technique'],
  ['shapeLanguage', 'Shape language'],
  ['paletteAndLighting', 'Palette and lighting'],
  ['characterDirection', 'Characters'],
  ['environmentDirection', 'Environments'],
  ['propDirection', 'Props'],
  ['effectsDirection', 'Effects'],
  ['uiHudDirection', 'UI and HUD'],
  ['animationDirection', 'Animation'],
  ['accessibility', 'Accessibility'],
] as const;

type Props = {
  preset: CatalogPreset;
  compact?: boolean;
  imageFailures?: Partial<Record<PreviewKey, boolean>>;
  onImageFailure?: (key: PreviewKey) => void;
};

export function GameArtStylePreview({ preset, compact = false, imageFailures, onImageFailure }: Props) {
  const [localFailures, setLocalFailures] = useState<Partial<Record<PreviewKey, boolean>>>({});
  const previews = [
    { key: 'map' as const, label: 'Map', asset: preset.previewAssetSet.map },
    { key: 'character' as const, label: 'Character', asset: preset.previewAssetSet.character },
  ];

  function markFailed(key: PreviewKey) {
    setLocalFailures((current) => ({ ...current, [key]: true }));
    onImageFailure?.(key);
  }

  return (
    <section className={compact ? styles.artStylePreviewCompact : styles.artStylePreview} aria-label={`${preset.title} preview`}>
      <div className={styles.artStylePreviewHeading}>
        <div>
          <span className={styles.eyebrow}>Official preset</span>
          <h3>{preset.title}</h3>
        </div>
        <span>Revision {preset.presetVersion}</span>
      </div>
      <div className={styles.artStyleGallery}>
        {previews.map(({ key, label, asset }) => {
          const failed = Boolean(imageFailures?.[key] || localFailures[key]);
          return (
            <figure className={styles.artStylePreviewItem} key={key}>
              <div className={key === 'map' ? styles.artStyleMapFrame : styles.artStyleCharacterFrame}>
                {failed ? (
                  <div className={styles.artStyleImageUnavailable} role="status" aria-label={`${label} preview unavailable. ${asset.alt}`}>{label} preview unavailable.</div>
                ) : (
                  <Image
                    className={styles.artStylePixelImage}
                    src={asset.publicPath}
                    width={asset.width}
                    height={asset.height}
                    alt={asset.alt}
                    unoptimized
                    onError={() => markFailed(key)}
                  />
                )}
              </div>
              <figcaption>{label} study</figcaption>
            </figure>
          );
        })}
      </div>
      <dl className={styles.artStyleSpecification}>
        {specificationSections.map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{preset.specification[key]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
