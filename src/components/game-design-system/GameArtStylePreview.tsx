'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import type { GAME_ART_STYLE_CATALOG } from '@/lib/game-art-style/presets';
import type { GameArtStylePreviewAsset, GameArtStyleSnapshot } from '@/lib/game-art-style/schema';
import styles from './GameDesignSystemsPage.module.css';

type CatalogPreset = (typeof GAME_ART_STYLE_CATALOG)[number];
type PreviewKey = 'map' | 'character';
type PreviewMode = 'creation' | 'browse';
type SpecificationKey = keyof GameArtStyleSnapshot['specification'];

const specificationGroups: Array<{
  id: string;
  label: string;
  summaryKey: SpecificationKey;
  fields: Array<[SpecificationKey, string]>;
}> = [
  {
    id: 'visual',
    label: 'Visual identity',
    summaryKey: 'visualIdentity',
    fields: [['visualIdentity', 'Visual identity'], ['paletteAndLighting', 'Palette and lighting']],
  },
  {
    id: 'craft',
    label: 'Craft',
    summaryKey: 'pixelTechnique',
    fields: [['pixelTechnique', 'Pixel technique'], ['shapeLanguage', 'Shape language'], ['accessibility', 'Accessibility']],
  },
  {
    id: 'world',
    label: 'World',
    summaryKey: 'environmentDirection',
    fields: [['environmentDirection', 'Environments'], ['characterDirection', 'Characters'], ['propDirection', 'Props']],
  },
  {
    id: 'production',
    label: 'Production',
    summaryKey: 'animationDirection',
    fields: [['animationDirection', 'Animation'], ['effectsDirection', 'Effects'], ['uiHudDirection', 'UI and HUD']],
  },
];

function summarize(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > 96 ? `${compact.slice(0, 93).trimEnd()}...` : `${compact}...`;
}

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
  mode?: PreviewMode;
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
  const { compact = false, mode = 'browse', imageFailures, onImageFailure, showCustomization = false } = props;
  const preview = props.preset ?? props.snapshot;
  const [localFailures, setLocalFailures] = useState<Partial<Record<PreviewKey, boolean>>>({});
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => Object.fromEntries(
    specificationGroups.map((group) => [group.id, mode === 'browse' || group.id === 'visual']),
  ));
  const previews = [
    { key: 'map' as const, label: 'Map', asset: preview.previewAssetSet.map },
    { key: 'character' as const, label: 'Character', asset: preview.previewAssetSet.character },
  ];

  function markFailed(key: PreviewKey) {
    setLocalFailures((current) => ({ ...current, [key]: true }));
    onImageFailure?.(key);
  }

  const summaryItems = [
    ['Visual identity', summarize(preview.specification.visualIdentity)],
    ['Palette and lighting', summarize(preview.specification.paletteAndLighting)],
    ['Shape language', summarize(preview.specification.shapeLanguage)],
    ['Pixel technique', summarize(preview.specification.pixelTechnique)],
  ] as const;

  return (
    <section className={`${compact ? styles.artStylePreviewCompact : styles.artStylePreview} ${mode === 'creation' ? styles.artStylePreviewCreation : styles.artStylePreviewBrowse}`} aria-label={`${preview.title} preview`}>
      <div className={styles.artStylePreviewHeading}>
        <div>
          <span className={styles.eyebrow}>{mode === 'browse' ? 'Official preset' : 'Visual board'}</span>
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
      <section className={styles.artStyleDna} aria-labelledby={`art-style-dna-${mode}`}>
        <div className={styles.artStyleSectionHeading}>
          <span className={styles.eyebrow}>At a glance</span>
          <h4 id={`art-style-dna-${mode}`}>Visual DNA</h4>
        </div>
        <dl className={styles.artStyleDnaGrid}>
          {summaryItems.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      {mode === 'browse' ? (
        <nav className={styles.artStyleSectionNav} aria-label="Art style sections">
          {specificationGroups.map((group) => <a key={group.id} href={`#art-style-${mode}-${group.id}`}>{group.label}</a>)}
        </nav>
      ) : null}
      <div className={styles.artStyleSpecification}>
        {specificationGroups.map((group) => {
          const open = Boolean(openGroups[group.id]);
          return (
            <section className={styles.artStyleSpecificationGroup} id={`art-style-${mode}-${group.id}`} key={group.id}>
              <button
                className={styles.artStyleSpecificationToggle}
                type="button"
                aria-expanded={open}
                aria-controls={`art-style-${mode}-${group.id}-content`}
                onClick={() => setOpenGroups((current) => ({ ...current, [group.id]: !current[group.id] }))}
              >
                <span>
                  <strong>{group.label}</strong>
                  {!open ? <small>{preview.specification[group.summaryKey]}</small> : null}
                </span>
                <span aria-hidden="true">{open ? '-' : '+'}</span>
              </button>
              {open ? (
                <dl className={styles.artStyleSpecificationGroupContent} id={`art-style-${mode}-${group.id}-content`}>
                  {group.fields.map(([key, label]) => (
                    <div key={key}>
                      <dt>{label}</dt>
                      <dd>{preview.specification[key]}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </section>
          );
        })}
      </div>
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
