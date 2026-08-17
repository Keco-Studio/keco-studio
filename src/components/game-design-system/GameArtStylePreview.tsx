'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import type { GAME_ART_STYLE_CATALOG } from '@/lib/game-art-style/presets';
import type { GameArtStylePreviewAsset, GameArtStyleSnapshot } from '@/lib/game-art-style/schema';
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

type Props = ({
  preset: CatalogPreset;
  snapshot?: never;
  showCustomization?: false;
} | {
  preset?: never;
  snapshot: GameArtStyleSnapshot;
  showCustomization?: boolean;
}) & {
  compact?: boolean;
  imageFailures?: Partial<Record<PreviewKey, boolean>>;
  onImageFailure?: (key: PreviewKey) => void;
};

function ArtStylePreviewFrame({
  asset,
  failed,
  frameClassName,
  label,
  onImageFailure,
}: {
  asset: GameArtStylePreviewAsset;
  failed: boolean;
  frameClassName: string;
  label: string;
  onImageFailure: () => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const updateScale = () => {
      const bounds = frame.getBoundingClientRect();
      const nextScale = Math.max(1, Math.floor(Math.min(
        bounds.width / asset.width,
        bounds.height / asset.height,
      )));
      setScale((current) => current === nextScale ? current : nextScale);
    };
    updateScale();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateScale);
      return () => window.removeEventListener('resize', updateScale);
    }
    const observer = new ResizeObserver(updateScale);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [asset.height, asset.width]);

  return (
    <div className={frameClassName} ref={frameRef}>
      {failed ? (
        <div className={styles.artStyleImageUnavailable} role="status" aria-label={`${label} preview unavailable. ${asset.alt}`}>{label} preview unavailable.</div>
      ) : (
        <Image
          className={styles.artStylePixelImage}
          src={asset.publicPath}
          width={asset.width}
          height={asset.height}
          style={{ width: asset.width * scale, height: asset.height * scale }}
          alt={asset.alt}
          unoptimized
          onError={onImageFailure}
        />
      )}
    </div>
  );
}

export function GameArtStylePreview(props: Props) {
  const { compact = false, imageFailures, onImageFailure, showCustomization = false } = props;
  const preview = props.preset ?? props.snapshot;
  const [localFailures, setLocalFailures] = useState<Partial<Record<PreviewKey, boolean>>>({});
  const previews = [
    { key: 'map' as const, label: 'Map', asset: preview.previewAssetSet.map },
    { key: 'character' as const, label: 'Character', asset: preview.previewAssetSet.character },
  ];

  function markFailed(key: PreviewKey) {
    setLocalFailures((current) => ({ ...current, [key]: true }));
    onImageFailure?.(key);
  }

  return (
    <section className={compact ? styles.artStylePreviewCompact : styles.artStylePreview} aria-label={`${preview.title} preview`}>
      <div className={styles.artStylePreviewHeading}>
        <div>
          <span className={styles.eyebrow}>Official preset</span>
          <h3>{preview.title}</h3>
        </div>
        <span>Revision {preview.presetVersion}</span>
      </div>
      <div className={styles.artStyleGallery}>
        {previews.map(({ key, label, asset }) => {
          const failed = Boolean(imageFailures?.[key] || localFailures[key]);
          return (
            <figure className={styles.artStylePreviewItem} key={key}>
              <ArtStylePreviewFrame
                asset={asset}
                failed={failed}
                frameClassName={key === 'map' ? styles.artStyleMapFrame : styles.artStyleCharacterFrame}
                label={label}
                onImageFailure={() => markFailed(key)}
              />
              <figcaption>{label} study</figcaption>
            </figure>
          );
        })}
      </div>
      <dl className={styles.artStyleSpecification}>
        {specificationSections.map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{preview.specification[key]}</dd>
          </div>
        ))}
      </dl>
      {showCustomization && props.snapshot ? (
        <section className={styles.artStyleCustomization} aria-label="Saved art style customization">
          <div>
            <span className={styles.eyebrow}>Immutable version input</span>
            <h4>Saved customization</h4>
          </div>
          <dl>
            <div><dt>Custom direction</dt><dd>{props.snapshot.customization.direction || 'Not specified'}</dd></div>
            <div>
              <dt>Visual references</dt>
              <dd>{props.snapshot.customization.referenceGames.length > 0 ? (
                <ul className={styles.artStyleReferenceList}>
                  {props.snapshot.customization.referenceGames.map((reference) => (
                    <li key={reference.name}><strong>{reference.name}</strong><span>{reference.borrow}</span></li>
                  ))}
                </ul>
              ) : 'None specified'}</dd>
            </div>
            <div><dt>Avoid guidance</dt><dd>{props.snapshot.customization.avoid || 'Not specified'}</dd></div>
          </dl>
        </section>
      ) : null}
    </section>
  );
}
