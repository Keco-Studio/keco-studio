'use client';
import { useRef, useState } from 'react';
import {
  checkBoard,
  effects,
  example,
  fromScript,
  movements,
  sceneHtml,
  type Shot,
  type Storyboard,
} from '@/lib/script-system/shotScript';
import { CharacterCards } from './CharacterCards';
import { castIsReady } from '@/lib/script-system/shotCast';
import { shotContinuity } from '@/lib/script-system/shotContinuity';
import type { FlowRow } from '@/lib/script-system/flow-editing/model';
import styles from './ShotScriptPanel.module.css';

const cameraLabels: Record<Shot['movement'], string> = {'静止':'Static','推进':'Push in','拉远':'Pull back','左摇':'Pan left','右摇':'Pan right'};
const effectLabels: Record<Shot['tags'][number], string> = {'淡入':'Fade in','人物入场':'Character entrance','震动':'Camera shake','暗场':'Fade to dark'};

type Template = { id: string; board: Storyboard };
type Props = {
  charactersOpen?: boolean;
  onSwitch?: (view: 'characters' | 'shots') => void;
  projectId: string;
  libraryId: string;
  rows: FlowRow[];
  scenes: Map<string, string>;
};
export function ShotScriptPanel({ projectId, libraryId, rows, scenes, charactersOpen, onSwitch }: Props) {
  const storeKey = 'keco.shots.templates.v1:' + projectId;
  const castKey = 'keco.script.cast:' + projectId + ':' + libraryId;
  const [initial] = useState(() => {
    try {
      const current = fromScript(rows, 'Current Script shots', scenes);
      try {
        const saved = JSON.parse(localStorage.getItem(castKey) || '{}');
        return { board: checkBoard({ ...current, characterGuide: saved.characterGuide, castSprites: saved.castSprites }), message: '' };
      } catch { return { board: current, message: '' }; }
    } catch (e) {
      return {
        board: structuredClone(example),
        message: 'Could not import the current Script. Showing the example instead: ' + (e as Error).message,
      };
    }
  });
  const [board, setBoard] = useState(initial.board);
  const [index, setIndex] = useState(0);
  const [message, tell] = useState(initial.message);
  const [templates, list] = useState<Template[]>(() => {
    try {
      return readTemplates();
    } catch {
      return [];
    }
  });
  const [choice, select] = useState('example');
  const [active, setActive] = useState('');
  const preview = useRef<HTMLIFrameElement>(null);
  const [movie, setMovie] = useState('');
  const [run, restart] = useState(0);
  const [brief, setBrief] = useState('');
  const [generating, setGenerating] = useState(false);
  type Draft = {board:Storyboard;active:string;choice:string;index:number};
  const history=useRef<{past:Draft[];future:Draft[]}>({past:[],future:[]});
  function saveCast(board: Storyboard) {
    localStorage.setItem(castKey, JSON.stringify({ characterGuide: board.characterGuide, castSprites: board.castSprites }));
  }
  function invalidateCastShots(sprites: Storyboard['castSprites']) {
    const changed = new Set([...(board.castSprites ?? []), ...(sprites ?? [])]
      .filter(c => !(board.castSprites ?? []).some(old => old.name === c.name && old.image === c.image)
        || !(sprites ?? []).some(next => next.name === c.name && next.image === c.image)).map(c => c.name));
    return board.shots.map(s => {
      if (!changed.size || s.visibleCast && !s.visibleCast.some(name => changed.has(name))) return s;
      const { artwork, visibleCast, ...rest } = s;
      return rest;
    });
  }
  function travel(redo:boolean){
    const from=redo?history.current.future:history.current.past;
    const previous=from.pop();if(!previous)return;
    (redo?history.current.past:history.current.future).push({board,active,choice,index});
    revision.current++;setBoard(previous.board);setIndex(previous.index);setActive(previous.active);select(previous.choice);setMovie('');tell(redo?'Redone':'Undone');
    if (previous.board.characterGuide !== board.characterGuide || previous.board.castSprites !== board.castSprites) {
      try { saveCast(previous.board); } catch { tell('Browser storage is full. This change is only available in this session.'); }
    }
  }
  const revision = useRef(0);
  async function requestGeneration(artworkShotId?: string, source = board, prepareCast = false, characterName?: string, profilesOnly = false) {
    const referenceId = artworkShotId && shotContinuity(source).context(artworkShotId).referenceId;
    const shots = source.shots.map(({ artwork: _image, backdrop, ...shot }) => shot.id === referenceId && backdrop ? { ...shot, backdrop } : shot);
    const response = await fetch('/api/script-shot-generation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, libraryId, board: { ...source, castSprites: artworkShotId || prepareCast ? source.castSprites : undefined, shots }, brief, ...(prepareCast ? { prepareCast: true, characterName, profilesOnly: profilesOnly || undefined } : {}), ...(artworkShotId ? { artworkShotId } : {}) }),
    });
    if (!response.headers.get('content-type')?.includes('application/json'))
      throw Error(
        'The AI service is unavailable. Open the signed-in Conversation to generate shots.',
      );
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'Generation failed');
    return result;
  }
  async function prepareCast(characterName?: string, profilesOnly = false) {
    const started = revision.current;
    setGenerating(true);
    tell(profilesOnly ? 'Drafting character profiles…' : 'Generating reference art for ' + characterName + '…');
    try {
      const result = await requestGeneration(undefined, board, true, characterName, profilesOnly);
      if (started !== revision.current) { tell('The draft changed. Prepare the updated character designs.'); return; }
      const cast = { characterGuide: result.characterGuide, castSprites: result.castSprites };
      const next = checkBoard({ ...board, ...cast, shots: invalidateCastShots(cast.castSprites) });
      update(next);
      try { localStorage.setItem(castKey, JSON.stringify(cast)); }
      catch { tell('Designs are available for this session. Browser storage is full.'); return; }
      tell(result.warning || (profilesOnly ? 'Profiles ready. Review each character before generating reference art.' : 'Reference art saved for ' + characterName + '.'));
    } catch (e) { tell((e as Error).message); } finally { setGenerating(false); }
  }
  async function directShots(artwork = false) {
    const started = revision.current;
    setGenerating(true);
    tell(artwork ? 'Illustrating this shot with PixelLab…' : 'Generating camera moves, timing and effects…');
    try {
      const result = await requestGeneration(artwork ? board.shots[index].id : undefined);
      if (started !== revision.current) {
        tell('Your draft changed during generation. The AI result was not applied.');
        return;
      }
      const next = artwork
        ? checkBoard({ ...board, characterGuide: result.characterGuide, castSprites: result.castSprites, shots: board.shots.map((s, i) => i === index ? { ...s, artwork: result.artwork, backdrop: result.backdrop, visibleCast: result.visibleCast } : s) })
        : checkBoard({ ...result.board, castSprites: board.castSprites, shots: result.board.shots.map((s: Shot, i: number) => ({ ...s, artwork: board.shots[i].artwork, backdrop: board.shots[i].backdrop, visibleCast: board.shots[i].visibleCast })) });
      update(next);
      tell(artwork ? 'Scene artwork is ready.' : 'Shot directions updated. Illustrate a shot to add its scene image.');
    } catch (e) {
      tell((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }
  async function illustrateScene(regenerate = false) {
    const started = revision.current;
    setGenerating(true);
    let next: Storyboard = regenerate ? { ...board, shots: board.shots.map(({ artwork: _previous, backdrop: _background, ...shot }) => shot) } : board;
    let illustrated = 0;
    try {
      for (const [i, shot] of shotContinuity(next).order.entries()) {
        if (shot.artwork) continue;
        tell('Illustrating shot ' + (i + 1) + ' of ' + board.shots.length + '…');
        const result = await requestGeneration(shot.id, next);
        if (revision.current !== started) throw Error('The draft changed. Generate again from the updated shots.');
        next = checkBoard({ ...next, characterGuide: result.characterGuide, castSprites: result.castSprites, shots: next.shots.map(s => s.id === shot.id ? { ...s, artwork: result.artwork, backdrop: result.backdrop, visibleCast: result.visibleCast } : s) });
        illustrated++;
      }
      if (next !== board) update(next);
      setMovie(sceneHtml(next));
      restart(n => n + 1);
      tell('Scene preview is ready.');
      requestAnimationFrame(() => preview.current?.scrollIntoView({ block: 'nearest' }));
    } catch (e) {
      if (illustrated && revision.current === started) update(next);
      tell((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }
  function readTemplates(): Template[] {
    const data = JSON.parse(localStorage.getItem(storeKey) ?? '[]');
    return data.map((t: Template) => ({
      id: t.id,
      board: checkBoard(t.board),
    }));
  }
  const shot = board.shots[index];
  function update(next: Storyboard) {
    revision.current++;
    history.current.past=[...history.current.past,{board,active,choice,index}].slice(-50);history.current.future=[];
    setBoard(next);
    setMovie('');
    tell('');
  }
  function edit(change: Partial<Shot>) {
    update({
      ...board,
      shots: board.shots.map((s, i) => (i === index ? { ...s, ...change } : s)),
    });
  }
  function load(next: Storyboard, id: string) {
    update(structuredClone(next));
    setIndex(0);
    setActive(id);
  }
  function save() {
    try {
      const saved = checkBoard(board);
      const stored = readTemplates();
      const original = stored.find((t) => t.id === active);
      const id =
        original?.board.name === saved.name ? active : crypto.randomUUID();
      if (stored.some((t) => t.id !== id && t.board.name === saved.name)) {
        tell('This template name is already in use. Choose another name or load the existing template.');
        return;
      }
      const next = [...stored.filter((t) => t.id !== id), { id, board: saved }];
      localStorage.setItem(storeKey, JSON.stringify(next));
      list(next);
      setActive(id);
      select(id);
      tell('Template saved to this project.');
    } catch {
      tell(
        'Could not save. Check the template name, choices, destinations, shot durations and browser storage.',
      );
    }
  }
  function exportAnimation() {
    try {
      const html = sceneHtml(board);
      const url = URL.createObjectURL(
        new Blob([html], { type: 'text/html;charset=utf-8' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = (board.name || 'Scene animation') + '.html';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      tell('');
    } catch {
      tell('Check the name, branch targets, choice labels and durations before generating again.');
    }
  }
  const castReady = castIsReady(board);
  if (charactersOpen) return (
    <section className={styles.panel} aria-label="Characters">
      <h3>Characters</h3>
      <p>Define the cast for this Conversation. Each scene reuses the same character artwork.</p>
      <CharacterCards board={board} busy={generating} generate={name => prepareCast(name)}
        draft={() => prepareCast(undefined, true)} save={guide => {
          const cast = {characterGuide: guide, castSprites: (board.castSprites ?? []).filter(sprite =>
            guide.split('\n').some(line => line.trim() === sprite.appearance))};
          localStorage.setItem(castKey, JSON.stringify(cast));
          update({...board, ...cast, shots: invalidateCastShots(cast.castSprites)});
          tell('Character profiles saved.');
        }} />
      <div className={styles.bar}>
        <button disabled={!castReady || generating} onClick={() => onSwitch?.('shots')}>Continue to Shot Script</button>
      </div>
      <span role="status">{message}</span>
    </section>
  );
  return (
    <section className={styles.panel} aria-label="Shot Script" tabIndex={0} onKeyDown={e=>{
        if((e.ctrlKey||e.metaKey) && !e.altKey && e.key.toLowerCase()==='z' && !(e.target as Element).closest('textarea,input:not([type=checkbox]):not([type=number]),[contenteditable=true]')){
          e.preventDefault();travel(e.shiftKey);
        }
      }}>
      <h3>Shot Script</h3>
      <div className={styles.bar}><span>{castReady ? 'Character designs ready.' : 'Prepare the cast before illustrating new shots.'}</span><button onClick={() => onSwitch?.('characters')}>Open Characters</button></div>
      {movie && <iframe ref={preview} key={libraryId + run} title="Scene animation" sandbox="allow-scripts" srcDoc={movie} />}

      <div className={styles.bar}><button disabled={!history.current.past.length} onClick={()=>travel(false)}>Undo</button><button disabled={!history.current.future.length} onClick={()=>travel(true)}>Redo</button></div>
      <div className={styles.bar}>
        <label>
          Director’s notes
          <input
            value={brief}
            maxLength={1000}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="Example: Push in slowly, then shake briefly at the knock."
          />
        </label>
        <button disabled={generating} onClick={() => void directShots()}>
          {generating ? 'Generating…' : 'Generate shots with AI'}
        </button>
      </div>
      <div className={styles.bar}>
        <label>
          Shot template
          <select value={choice} onChange={(e) => select(e.target.value)}>
            <option value="example">Built-in · At the Door</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.board.name}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => {
            const t = templates.find((t) => t.id === choice);
            load(t?.board ?? example, t?.id ?? '');
            tell('Template loaded. To save a new copy, change its name.');
          }}
        >
          Load template
        </button>
        <button
          onClick={() => {
            try {
              load(fromScript(rows, 'Current Script shots', scenes), '');
            } catch (e) {
              tell((e as Error).message);
            }
          }}
        >
          Load from current Script
        </button>
      </div>
      <label>
        Template name
        <input
          value={board.name}
          maxLength={100}
          onChange={(e) => update({ ...board, name: e.target.value })}
        />
      </label>
      <div className={styles.bar}>
        <label>
          Current shot
          <select
            value={index}
            onChange={(e) => setIndex(Number(e.target.value))}
          >
            {board.shots.map((s, i) => (
              <option key={s.id} value={i}>
                {i + 1} · {s.scene} · {s.line.slice(0, 36)}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => {
            const next = {
              ...shot,
              id: crypto.randomUUID(),
              line: '',
              exits: [],
            };
            update({ ...board, shots: [...board.shots, next] });
            setIndex(board.shots.length);
          }}
        >
          Add shot
        </button>
      </div>
      <div className={styles.grid}>
        <label>
          Scene
          <input
            value={shot.scene}
            onChange={(e) => edit({ scene: e.target.value })}
          />
        </label>
        <label>
          Speaker
          <input
            placeholder="Narrator"
            value={shot.speaker}
            onChange={(e) => edit({ speaker: e.target.value })}
          />
        </label>
      </div>
      <label>
        Dialogue
        <textarea
          value={shot.line}
          onChange={(e) => edit({ line: e.target.value })}
        />
      </label>
      <div className={styles.grid}>
        <label>
          Camera movement
          <select
            value={shot.movement}
            onChange={(e) =>
              edit({ movement: e.target.value as Shot['movement'] })
            }
          >
            {movements.map((m) => (
              <option key={m} value={m}>{cameraLabels[m]}</option>
            ))}
          </select>
        </label>
        <label>
          Duration (seconds)
          <input
            type="number"
            min=".2"
            max="60"
            step=".1"
            value={shot.seconds}
            onChange={(e) => edit({ seconds: Number(e.target.value) })}
          />
        </label>
      </div>
      <fieldset>
        <legend>Animation effects</legend>
        {effects.map((tag) => (
          <label className={styles.check} key={tag}>
            <input
              type="checkbox"
              checked={shot.tags.includes(tag)}
              onChange={(e) =>
                edit({
                  tags: e.target.checked
                    ? [...shot.tags, tag]
                    : shot.tags.filter((t) => t !== tag),
                })
              }
            />
            {effectLabels[tag]}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Next shot / Dialogue branches</legend>
        {shot.exits.length === 0 && <small>Playback ends after this shot.</small>}
        {shot.exits.map((exit, i) => (
          <div key={i} className={styles.bar}>
            <label>
              Choice text
              <input
                placeholder="Leave blank to advance automatically"
                value={exit.label}
                onChange={(e) =>
                  edit({
                    exits: shot.exits.map((x, j) =>
                      i === j ? { ...x, label: e.target.value } : x,
                    ),
                  })
                }
              />
            </label>
            <label>
              Target shot
              <select
                value={exit.target ?? ''}
                onChange={(e) =>
                  edit({
                    exits: shot.exits.map((x, j) =>
                      i === j ? { ...x, target: e.target.value || null } : x,
                    ),
                  })
                }
              >
                <option value="">End</option>
                {board.shots.map((s, j) => (
                  <option key={s.id} value={s.id}>
                    {j + 1} · {s.scene} · {s.line.slice(0, 22)}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() =>
                edit({ exits: shot.exits.filter((_, j) => i !== j) })
              }
            >
              Remove
            </button>
          </div>
        ))}
        <button
          onClick={() =>
            edit({
              exits: [
                ...shot.exits,
                {
                  label: 'Choice ' + (shot.exits.length + 1),
                  target: board.shots[index + 1]?.id ?? null,
                },
              ],
            })
          }
        >
          Add branch
        </button>
      </fieldset>
      <div className={styles.bar}>
        <button disabled={generating || !castReady} onClick={() => directShots(true)}>{shot.artwork ? 'Regenerate scene artwork' : 'Generate scene artwork'} · PixelLab</button>
        <span>Illustrates the selected shot.</span>
      </div>
      {shot.artwork && <img className={styles.artwork} src={shot.artwork} alt={shot.scene} />}
      <div className={styles.bar}>
        <button onClick={save}>Save template</button>
        <button disabled={generating || (!castReady && board.shots.some(s => !s.artwork))} onClick={() => illustrateScene()}>{board.shots.some(s => !s.artwork) ? 'Illustrate scene with PixelLab and play' : 'Play illustrated scene'}</button>
        {board.shots.some(s => s.artwork) && <button disabled={generating || !castReady} onClick={() => illustrateScene(true)}>Re-illustrate entire scene</button>}
        <button onClick={exportAnimation}>Export animation as HTML</button>
      </div>
      <span role="status">{message}</span>

    </section>
  );
}
