'use client';

import { useState } from 'react';
import type { Shot, Storyboard } from '@/lib/script-system/shotScript';
import styles from './ShotScriptPanel.module.css';

async function readImage(src: string) {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
}

type Props = {
  board: Storyboard;
  shot: Shot;
  apply: (fields: Pick<Shot, 'artwork' | 'backdrop' | 'visibleCast'>) => void;
};

export function ReuseBackdrop({ board, shot, apply }: Props) {
  const sources = board.shots.filter(s => s.backdrop);
  const [sourceId, select] = useState('');
  const [cast, setCast] = useState(shot.visibleCast ?? [shot.speaker]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const source = sources.find(s => s.id === sourceId) ?? sources.find(s => s.scene === shot.scene) ?? sources[0];
  if (!source?.backdrop) return null;

  async function assemble() {
    const backdrop = source.backdrop!;
    const sprites = (board.castSprites ?? []).filter(sprite => cast.includes(sprite.name));
    setBusy(true);
    setError('');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 192;
      canvas.height = 112;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw Error('Canvas unavailable');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(await readImage(backdrop), 0, 0, 192, 112);
      const images = await Promise.all(sprites.map(sprite => readImage(sprite.image)));
      const width = Math.min(48, Math.floor(184 / Math.max(1, images.length)));
      const height = Math.round(width * 80 / 48);
      images.forEach((image, i) => ctx.drawImage(image,
        Math.round(192 * (i + 0.5) / images.length - width / 2), 106 - height, width, height));
      apply({backdrop, artwork: canvas.toDataURL('image/png'), visibleCast: sprites.map(s => s.name)});
    } catch { setError('Could not compose this shot. Check the source artwork and try again.'); }
    finally { setBusy(false); }
  }
  return <details>
    <summary>Reuse an existing background</summary>
    <label>Background from shot<select value={source.id} onChange={e => select(e.target.value)}>
      {sources.map(s => <option key={s.id} value={s.id}>{s.scene} · {s.line.slice(0,48)}</option>)}
    </select></label>
    <fieldset><legend>Characters in this shot</legend>
      {board.castSprites?.map(s => <label className={styles.check} key={s.name}>
        <input type="checkbox" checked={cast.includes(s.name)} onChange={e =>
          setCast(e.target.checked ? [...cast,s.name] : cast.filter(name => name !== s.name))}/>{s.name}
      </label>)}
    </fieldset>
    <button disabled={busy} onClick={assemble}>Compose shot locally</button>
    {error && <span role="alert">{error}</span>}
  </details>;
}
