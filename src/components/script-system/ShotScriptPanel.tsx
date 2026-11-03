'use client';
import { useEffect, useRef, useState } from 'react';
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
import { GenerationQueue, type QueueRow } from '@/lib/script-system/generationQueue';
import { CharacterCards } from './CharacterCards';
import { castDefinitions, castIsReady } from '@/lib/script-system/shotCast';
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
  const latest = useRef(board);
  const [queueRows, setQueueRows] = useState<QueueRow[]>([]);
  const [queue] = useState(() => new GenerationQueue(setQueueRows));
  const pending = queueRows.map(row => row.key);
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [batch, setBatch] = useState(false);
  const batchActive = useRef(false);
  const navigation = useRef({active,choice,index});
  navigation.current = {active,choice,index};
  function schedule(key: string, task: (signal: AbortSignal) => Promise<void>, dependency?: Promise<void>) {
    const existing = queue.get(key);
    if (existing) return existing;
    setFailures(old => { const copy = {...old}; delete copy[key]; return copy; });
    const promise = queue.add(key, task, dependency);
    void promise.catch(e => setFailures(old => ({...old, [key]: (e as Error).message})));
    return promise;
  }
  type Draft = {board:Storyboard;active:string;choice:string;index:number};
  const history=useRef<{past:Draft[];future:Draft[]}>({past:[],future:[]});
  function saveCast(board: Storyboard) {
    localStorage.setItem(castKey, JSON.stringify({ characterGuide: board.characterGuide, castSprites: board.castSprites }));
  }
  function invalidateCastShots(sprites: Storyboard['castSprites'], board = latest.current) {
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
    revision.current++;latest.current=previous.board;setBoard(previous.board);setIndex(previous.index);setActive(previous.active);select(previous.choice);setMovie('');tell(redo?'Redone':'Undone');
    if (previous.board.characterGuide !== board.characterGuide || previous.board.castSprites !== board.castSprites) {
      try { saveCast(previous.board); } catch { tell('Browser storage is full. This change is only available in this session.'); }
    }
  }
  const revision = useRef(0);
  useEffect(() => () => {
    revision.current++;
    queue.cancelAll();
  }, [queue]);
  async function requestGeneration(signal: AbortSignal, artworkShotId?: string, source = board, prepareCast = false, characterName?: string, profilesOnly = false) {
    const referenceId = artworkShotId && shotContinuity(source).context(artworkShotId).referenceId;
    const shots = source.shots.map(({ artwork: _image, backdrop, ...shot }) => shot.id === referenceId && backdrop ? { ...shot, backdrop } : shot);
    const redrawBackground = artworkShotId && Boolean(source.shots.find(s => s.id === artworkShotId)?.artwork);
    const response = await fetch('/api/script-shot-generation', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, libraryId, board: { ...source, castSprites: artworkShotId || prepareCast ? source.castSprites : undefined, shots }, brief, ...(prepareCast ? { prepareCast: true, characterName, profilesOnly: profilesOnly || undefined } : {}), ...(artworkShotId ? { artworkShotId, redrawBackground: redrawBackground || undefined } : {}) }),
    });
    if (!response.headers.get('content-type')?.includes('application/json'))
      throw Error(
        'The AI service is unavailable. Open the signed-in Conversation to generate shots.',
      );
    const result = await response.json();
    signal.throwIfAborted();
    if (!response.ok) throw Error(result.error || 'Generation failed');
    return result;
  }
  async function prepareCast(characterName?: string, profilesOnly = false) {
    const source = latest.current;
    const epoch = revision.current;
    const key = characterName ? 'Character: ' + characterName : 'Character profiles';
    try {
      await schedule(key, async signal => {
        if (epoch !== revision.current) throw Error('The draft changed. Generate again.');
        const result = await requestGeneration(signal, undefined, source, true, characterName, profilesOnly);
        if (result.warning) throw Error(result.warning);
        const current = latest.current;
        let sprites: Storyboard['castSprites'] = result.castSprites;
        let guide: string = result.characterGuide;
        if (epoch !== revision.current) throw Error('The draft changed. Generate again.');
        if (characterName) {
          const sprite = sprites?.find(s => s.name === characterName);
          if (!sprite || !castDefinitions(current.characterGuide || '').some(d => d.name === characterName && d.appearance === sprite.appearance))
            throw Error('The character profile changed. Generate its updated reference.');
          guide = current.characterGuide!;
          sprites = [...(current.castSprites ?? []).filter(s => s.name !== characterName), sprite];
        } else if (current !== source) throw Error('The draft changed. Draft profiles again.');
        const next = checkBoard({...current, characterGuide: guide, castSprites: sprites, shots: invalidateCastShots(sprites)});
        update(next);
        try { saveCast(next); } catch { throw Error('Designs are available for this session. Browser storage is full.'); }
        tell(characterName ? 'Reference art saved for ' + characterName + '.' : 'Profiles ready.');
      });
    } catch (e) { tell((e as Error).message); }
  }
  function renderShot(id: string, dependency?: Promise<void>) {
    if (!dependency && pending.length) {
      const continuity = shotContinuity(latest.current);
      for (let parent = continuity.parentId(id); parent; parent = continuity.parentId(parent)) {
        dependency = queue.get('Shot: ' + parent);
        if (dependency) break;
      }
    }
    const epoch = revision.current;
    return schedule('Shot: ' + id, async signal => {
      const source = latest.current;
      const target = source.shots.find(s => s.id === id);
      if (!target || epoch !== revision.current) throw Error('The shot draft changed.');
      const result = await requestGeneration(signal, id, source);
      const current = latest.current;
      const now = current.shots.find(s => s.id === id);
      if (epoch !== revision.current || !now || now.line !== target.line || now.scene !== target.scene ||
          now.speaker !== target.speaker || current.characterGuide !== source.characterGuide ||
          result.visibleCast.some((name: string) => current.castSprites?.find(s => s.name === name)?.image !== source.castSprites?.find(s => s.name === name)?.image) ||
          JSON.stringify(shotContinuity(current).context(id).beats) !== JSON.stringify(shotContinuity(source).context(id).beats))
        throw Error('The shot or its characters changed. Generate the updated shot.');
      update({...current, shots: current.shots.map(s => s.id === id ? {...s, artwork: result.artwork,
        backdrop: result.backdrop, visibleCast: result.visibleCast} : s)});
    }, dependency);
  }
  async function directShots(artwork = false) {
    try {
      if (artwork) {
        await renderShot(board.shots[index].id);
        tell('Scene artwork is ready.');
      } else {
        const source = latest.current;
        const epoch = revision.current;
        await schedule('Shot directions', async signal => {
          if (epoch !== revision.current) throw Error('The draft changed. Generate directions again.');
          const result = await requestGeneration(signal, undefined, source);
          const current = latest.current;
          const content = (shots: Shot[]) => JSON.stringify(shots.map(({artwork, backdrop, visibleCast, ...shot}) => shot));
          if (epoch !== revision.current || content(current.shots) !== content(source.shots)) throw Error('Your shots changed. Generate directions again.');
          update({...current, shots: current.shots.map((s, i) => {
            const {seconds, movement, tags} = result.board.shots[i];
            return {...s, seconds, movement, tags};
          })});
          tell('Shot directions updated.');
        });
      }
    } catch (e) { tell((e as Error).message); }
  }
  async function illustrateScene(regenerate = false) {
    if (batchActive.current) return;
    batchActive.current = true;
    setBatch(true);
    const epoch = revision.current;
    const source = latest.current;
    const continuity = shotContinuity(source);
    const tasks = new Map<string, Promise<void>>();
    try {
      for (const shot of continuity.order) {
        const parent = tasks.get(continuity.parentId(shot.id) ?? '');
        const task = regenerate || !shot.artwork || queue.get('Shot: ' + shot.id)
          ? renderShot(shot.id, parent)
          : Promise.resolve(parent);
        tasks.set(shot.id, task);
      }
      const results = await Promise.allSettled(tasks.values());
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      if (epoch !== revision.current || latest.current.shots.some(s => !s.artwork)) throw Error('The scene changed. Illustrate the remaining shots.');
      setMovie(sceneHtml(latest.current));
      restart(n => n + 1);
      tell('Scene preview is ready.');
      requestAnimationFrame(() => preview.current?.scrollIntoView?.({ block: 'nearest' }));
    } catch (e) { tell((e as Error).message); }
    finally { batchActive.current = false; setBatch(false); }
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
    history.current.past=[...history.current.past,{board: latest.current,...navigation.current}].slice(-50);history.current.future=[];
    latest.current = next;
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
    revision.current++;
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
  function jobTitle(key: string) {
    if (!key.startsWith('Shot: ')) return key;
    const i = board.shots.findIndex(s => s.id === key.slice(5));
    return i < 0 ? 'Removed shot' : 'Shot ' + (i + 1) + ' · ' + board.shots[i].scene;
  }
  const activity = <div aria-live="polite">
    {pending.length > 0 && <span>{pending.length} generation {pending.length === 1 ? 'task' : 'tasks'} in progress</span>}
    {queueRows.length > 0 && <section aria-label="Generation queue">
      <h4>Generation queue</h4>
      <ol className={styles.queue}>{queueRows.map(row => <li key={row.key}>
        <strong>{jobTitle(row.key)}</strong><span>{row.state}</span>
        <button aria-label={'Cancel ' + jobTitle(row.key)} onClick={() => queue.cancel(row.key)}>Cancel</button>
      </li>)}</ol>
    </section>}
    {Object.entries(failures).map(([key, reason]) => <p key={key}>{jobTitle(key)}: {reason}</p>)}
  </div>;
  if (charactersOpen) return (
    <section className={styles.panel} aria-label="Characters">
      <h3>Characters</h3>{activity}
      <p>Define the cast for this Conversation. Each scene reuses the same character artwork.</p>
      <CharacterCards board={board} busy={pending.includes('Character profiles')} pending={name => pending.includes('Character: ' + name)} generate={name => prepareCast(name)}
        draft={() => prepareCast(undefined, true)} save={guide => {
          const cast = {characterGuide: guide, castSprites: (board.castSprites ?? []).filter(sprite =>
            guide.split('\n').some(line => line.trim() === sprite.appearance))};
          localStorage.setItem(castKey, JSON.stringify(cast));
          update({...board, ...cast, shots: invalidateCastShots(cast.castSprites)});
          tell('Character profiles saved.');
        }} />
      <div className={styles.bar}>
        <button disabled={!castReady} onClick={() => onSwitch?.('shots')}>Continue to Shot Script</button>
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
      <h3>Shot Script</h3>{activity}
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
        <button disabled={pending.includes('Shot directions')} onClick={() => void directShots()}>
          {pending.includes('Shot directions') ? 'Generating…' : 'Generate shots with AI'}
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
              const current = fromScript(rows, 'Current Script shots', scenes);
              const cast = JSON.parse(localStorage.getItem(castKey) ?? '{}');
              load(checkBoard({...current, characterGuide: cast.characterGuide, castSprites: cast.castSprites}), '');
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
      {!castReady && <div className={styles.bar}>
        <span>Scene artwork needs a reference for each character.</span>
        <button onClick={() => onSwitch?.('characters')}>Set up character references</button>
        {!board.characterGuide && <button onClick={() => {
          try {
            const cast = JSON.parse(localStorage.getItem(castKey) ?? '{}');
            if (!cast.characterGuide) { onSwitch?.('characters'); return; }
            const next = checkBoard({...board, characterGuide: cast.characterGuide, castSprites: cast.castSprites});
            update({...next, shots: invalidateCastShots(next.castSprites)});
            if (!castIsReady(next)) onSwitch?.('characters');
            tell('Loaded character profiles from this Conversation.');
          } catch { tell('Could not read the saved profiles. Open Characters to review them.'); }
        }}>Use Conversation characters</button>}
      </div>}
      <div className={styles.bar}>
        <button disabled={pending.includes('Shot: ' + shot.id) || !castReady} onClick={() => directShots(true)}>{pending.includes('Shot: ' + shot.id) ? 'Generating…' : shot.artwork ? 'Regenerate scene artwork' : 'Generate scene artwork'} · PixelLab</button>
        <span>Illustrates the selected shot.</span>
      </div>
      {shot.artwork && <img className={styles.artwork} src={shot.artwork} alt={shot.scene} />}
      <div className={styles.bar}>
        <button onClick={save}>Save template</button>
        <button disabled={batch || (!castReady && board.shots.some(s => !s.artwork))} onClick={() => illustrateScene()}>{board.shots.some(s => !s.artwork) ? 'Illustrate scene with PixelLab and play' : 'Play illustrated scene'}</button>
        {board.shots.some(s => s.artwork) && <button disabled={batch || !castReady} onClick={() => illustrateScene(true)}>Re-illustrate entire scene</button>}
        <button onClick={exportAnimation}>Export animation as HTML</button>
      </div>
      <span role="status">{message}</span>

    </section>
  );
}
