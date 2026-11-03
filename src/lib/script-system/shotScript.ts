import { z } from 'zod';
import { analyzeFlow, flowText, type FlowRow } from './flow-editing/model';

export const movements = ['静止', '推进', '拉远', '左摇', '右摇'] as const;
export const effects = ['淡入', '人物入场', '震动', '暗场'] as const;
const png = z.string().max(1500000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
const shot = z.object({
  id: z.string().min(1),
  scene: z.string(),
  artwork: png.optional(),
  backdrop: png.optional(),
  visibleCast: z.array(z.string()).max(12).optional(),
  speaker: z.string(),
  line: z.string(),
  seconds: z.number().min(0.2).max(60),
  movement: z.enum(movements),
  tags: z.array(z.enum(effects)),
  exits: z.array(
    z.object({ label: z.string(), target: z.string().nullable() }),
  ),
});
export type Shot = z.infer<typeof shot>;
export const storyboard = z.object({
  version: z.literal(1),
  castSprites: z.array(z.object({ name: z.string().min(1).max(100), appearance: z.string().max(4000), image: png })).max(64).optional(),
  characterGuide: z.string().max(4000).optional(),
  name: z.string().trim().min(1).max(100),
  shots: z.array(shot).min(1).max(5000),
});
export type Storyboard = z.infer<typeof storyboard>;

export function checkBoard(input: unknown) {
  const board = storyboard.parse(input);
  const ids = new Set(board.shots.map((s) => s.id));
  if (
    ids.size !== board.shots.length ||
    board.shots.some((s) =>
      s.exits.some((e) => e.target !== null && !ids.has(e.target)),
    )
  )
    throw Error('Duplicate shot IDs or missing branch targets');
  if (
    board.shots.some(
      (s) => s.exits.length > 1 && s.exits.some((e) => !e.label.trim()),
    )
  )
    throw Error('Each branch needs choice text');
  return board;
}

export function fromScript(
  rows: FlowRow[],
  name: string,
  scenes: Map<string, string>,
): Storyboard {
  const { outlets, diagnostics } = analyzeFlow(rows);
  if (diagnostics.length) throw Error(diagnostics[0].message);
  const edges = new Map<string, Shot['exits']>();
  for (const p of outlets) {
    if (p.kind === 'end') continue;
    const list = edges.get(p.rowId) ?? [];
    list.push({ label: p.text ?? '', target: p.targetRowId ?? null });
    edges.set(p.rowId, list);
  }
  return checkBoard({
    version: 1,
    name,
    shots: rows.map((r) => ({
      id: r.id,
      scene: scenes.get(r.id) || 'Scene',
      speaker: flowText(r.values.Name),
      line: flowText(r.values.Content),
      seconds: 3,
      movement: '推进',
      tags: ['淡入'],
      exits: edges.get(r.id) ?? [],
    })),
  });
}

export const example: Storyboard = {
  version: 1,
  name: '门口的选择',
  shots: [
    {
      id: 'start',
      scene: '门厅',
      speaker: '旁白',
      line: '门外传来敲门声。',
      seconds: 2,
      movement: '推进',
      tags: ['淡入'],
      exits: [
        { label: '开门', target: 'door' },
        { label: '等待', target: 'wait' },
      ],
    },
    {
      id: 'door',
      scene: '门厅',
      speaker: '来客',
      line: '这是给你的信。',
      seconds: 2,
      movement: '左摇',
      tags: ['人物入场'],
      exits: [],
    },
    {
      id: 'wait',
      scene: '走廊',
      speaker: '旁白',
      line: '脚步声渐渐远去。',
      seconds: 3,
      movement: '拉远',
      tags: ['暗场'],
      exits: [],
    },
  ],
};

// The downloadable scene and the in-app player use the exact same self-contained timeline.
export function sceneHtml(input: Storyboard, quickPreview = false) {
  const board = checkBoard(input);
  const json = JSON.stringify(board).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scene animation</title><style>
*{box-sizing:border-box}body{margin:0;background:#132133;color:#fff;font:16px system-ui}main{overflow:hidden;position:relative;min-height:310px;height:100vh;background:#14243b}#world{position:absolute;inset:-16%;background:linear-gradient(155deg,var(--sky),#263c56 58%,#101a29);transform-origin:50% 40%}#art{width:100%;height:100%;object-fit:fill;image-rendering:pixelated}#actors{position:absolute;inset:0;pointer-events:none}#actors img{position:absolute;image-rendering:pixelated;transform:translateX(-50%)}#unillustrated{position:absolute;inset:38% 0 auto;text-align:center;color:#c4d2df}.top,.dialog{position:absolute;left:5%;right:5%}.top{top:6%;font-size:13px}.dialog{bottom:7%;background:#101925df;padding:14px;border-radius:8px}p{white-space:pre-wrap;margin:.45em 0}button{background:#f2f7ff;color:#132133;border:0;border-radius:5px;margin:5px 6px 0 0;padding:7px 12px;cursor:pointer}
@keyframes push{to{transform:scale(1.24)}}@keyframes pull{from{transform:scale(1.24)}}@keyframes left{to{transform:translateX(-8%)}}@keyframes right{to{transform:translateX(8%)}}@keyframes enter{from{transform:translateX(120px);opacity:0}}@keyframes fade{from{opacity:0}}@keyframes shake{25%,75%{transform:translateX(-5px)}50%{transform:translateX(5px)}}@keyframes dark{to{background:#000a}}#veil{position:absolute;inset:0;pointer-events:none}</style><main id="stage"><div id="world"><img id="art" alt=""><div id="actors"></div><span id="unillustrated">Scene artwork has not been generated</span></div><div id="veil"></div><div class="top" id="scene"></div><div class="dialog"><b id="speaker"></b><p id="line"></p><div id="choices"></div></div></main><script>
const quickPreview=${quickPreview};const board=${json};document.title=board.name;const shots=new Map(board.shots.map(s=>[s.id,s]));const el=id=>document.getElementById(id);let timer;
function button(text,fn){const b=document.createElement('button');b.textContent=text;b.onclick=fn;el('choices').append(b)}
function finish(){clearTimeout(timer);el('choices').replaceChildren();el('speaker').textContent='Playback complete';button('Replay',()=>play(board.shots[0].id))}
function play(id){clearTimeout(timer);const s=shots.get(id);if(!s){finish();return}el('choices').replaceChildren();el('scene').textContent=board.name+' · '+s.scene;el('speaker').textContent=s.speaker||'Narrator';el('line').textContent=s.line;const w=el('world'),a=el('art'),v=el('veil'),stage=el('stage');for(const n of [w,a,v,stage])n.style.animation='none';void stage.offsetWidth;
w.style.setProperty('--sky','hsl('+([...s.scene].reduce((h,c)=>h+c.charCodeAt(0),0)%360)+' 30% 48%)');
const move={'推进':'push','拉远':'pull','左摇':'left','右摇':'right'}[s.movement];if(move)w.style.animation=move+' '+s.seconds+'s ease-in-out both';a.hidden=!s.artwork;el('unillustrated').hidden=!!s.artwork;if(s.artwork)a.src=s.artwork;else a.removeAttribute('src');const actors=el('actors');actors.replaceChildren();
const draft=quickPreview&&!s.artwork;
const cast=draft?(s.visibleCast||[s.speaker].filter(name=>board.castSprites?.some(c=>c.name===name))):s.visibleCast;
if(draft){el('unillustrated').textContent='Draft background';el('scene').textContent+=' · Quick preview';if(s.backdrop){a.hidden=false;a.src=s.backdrop;el('unillustrated').hidden=true}}
if(cast&&(draft||s.backdrop&&s.artwork)){if(s.backdrop)a.src=s.backdrop;const width=Math.min(48,Math.floor(184/Math.max(1,cast.length)));cast.forEach((name,i)=>{const sprite=board.castSprites?.find(c=>c.name===name);if(!sprite)return;const img=document.createElement('img');img.src=sprite.image;img.alt=name;img.style.width=(width/192*100)+'%';img.style.height=(Math.round(width*80/48)/112*100)+'%';img.style.left=((i+.5)/cast.length*100)+'%';img.style.bottom=(6/112*100)+'%';actors.append(img)});if(s.tags.includes('人物入场'))actors.animate([{opacity:0,translate:'8% 0'},{opacity:1,translate:'0 0'}],700)}if(s.tags.includes('暗场'))v.style.animation='dark '+s.seconds+'s forwards';stage.style.animation=[s.tags.includes('淡入')?'fade .5s':'',s.tags.includes('震动')?'shake .38s':''].filter(Boolean).join(',');
timer=setTimeout(()=>{if(!s.exits.length){finish();return}if(s.exits.length===1&&!s.exits[0].label){play(s.exits[0].target);return}for(const e of s.exits)button(e.label,()=>play(e.target));},s.seconds*1000)}
play(board.shots[0].id);</script></html>`;
}
