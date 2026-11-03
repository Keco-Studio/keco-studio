'use client';
import { useState } from 'react';
import { castDefinitions } from '@/lib/script-system/shotCast';
import type { Storyboard } from '@/lib/script-system/shotScript';
import styles from './ShotScriptPanel.module.css';

type Props = {
  board: Storyboard; busy: boolean; generate: (name: string) => void;
  draft: () => void; save: (guide: string) => void;
};
type Editor = { original?: string; name: string; description: string };

export function CharacterCards({ board, busy, generate, draft, save }: Props) {
  const [edit, setEdit] = useState<Editor | null>(null);
  const [error, setError] = useState('');
  let profiles: ReturnType<typeof castDefinitions> = [];
  let invalid = false;
  try { profiles = castDefinitions(board.characterGuide || 'None'); } catch { invalid = true; }
  function open(next: Editor) { setError(''); setEdit(next); }
  function submit() {
    if (!edit) return;
    const name = edit.name.trim();
    const description = edit.description.trim().replace(/\s*\r?\n\s*/g, ' ');
    if (!name || !description || /[—：:\n]/.test(name) || name.includes(' - ')) {
      setError('Enter a character name without separators and a description.'); return;
    }
    if (profiles.some(p => p.name === name && p.name !== edit.original)) {
      setError('A character already uses this name.'); return;
    }
    const line = name + ' — ' + description;
    const lines = profiles.map(p => edit.original === p.name ? line : p.appearance);
    if (!edit.original) lines.push(line);
    const guide = lines.join('\n');
    if (guide.length > 4000 || lines.length > 64) { setError('Use up to 64 profiles and 4,000 characters in total.'); return; }
    try { save(guide); setEdit(null); setError(''); }
    catch { setError('Could not save this profile in browser storage. Your edits are still here.'); }
  }
  const form = edit && <form className={styles.profileForm} onSubmit={e => {e.preventDefault(); submit();}}>
    <label>Name<input required autoFocus maxLength={100} value={edit.name} onChange={e => setEdit({...edit, name:e.target.value})}/></label>
    <label>Character description<textarea required rows={4} placeholder="Describe their silhouette, hairstyle, clothes and signature items." value={edit.description} onChange={e => setEdit({...edit, description:e.target.value})}/></label>
    <div className={styles.bar}><button type="submit">Save profile</button><button type="button" onClick={() => {setEdit(null);setError('');}}>Cancel</button></div>
    {error && <span role="alert">{error}</span>}
  </form>;
  return <>
    <div className={styles.bar}>
      <button disabled={busy || !!edit} onClick={()=>open({name:'',description:''})}>Add character</button>
      {!profiles.length && !invalid && <button disabled={busy || !!edit || board.characterGuide?.trim().toLowerCase()==='none'} onClick={draft}>Draft profiles from Script</button>}
      {!profiles.length && !board.characterGuide && <button disabled={busy || !!edit} onClick={() => {try { save('None'); } catch {setError('Could not save the empty cast.');}}}>Use an empty cast</button>}
    </div>
    {!edit && error && <span role="alert">{error}</span>}
    {invalid && <p role="alert">This saved guide cannot be read. Original text: {board.characterGuide}</p>}
    {edit && !edit.original && form}
    <div className={styles.castCards} aria-label="Character designs">
      {profiles.map(p => {
        const sprite = board.castSprites?.find(s=>s.name===p.name && s.appearance===p.appearance);
        const description = p.appearance.slice(p.name.length).replace(/^[\s:：—-]+/, '');
        return <article key={p.name} aria-label={p.name}>
          <div className={styles.reference}>{sprite ? <img alt={p.name + ' reference art'} src={sprite.image}/> : <span>No reference art yet</span>}</div>
          <h4>{p.name}</h4>
          {edit?.original===p.name ? form : <><p>{description}</p>
          <div className={styles.bar}>
            <button disabled={busy || !!edit} onClick={()=>open({original:p.name,name:p.name,description})}>Edit profile</button>
            <button disabled={busy || !!edit} onClick={()=>generate(p.name)}>{sprite?'Regenerate reference':'Generate reference'}</button>
          </div></>}
        </article>;
      })}
    </div>
  </>;
}
