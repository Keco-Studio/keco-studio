import type { CSSProperties } from 'react';
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
};

export function DirectMapCanvas({ plan, scene, image }: DirectMapCanvasProps) {
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
      </div>
    </div>
  );
}
