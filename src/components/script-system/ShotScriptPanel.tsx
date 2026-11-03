'use client';
import { useState } from 'react';
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
import type { FlowRow } from '@/lib/script-system/flow-editing/model';
import styles from './ShotScriptPanel.module.css';

type Template = { id: string; board: Storyboard };
type Props = {
  projectId: string;
  libraryId: string;
  rows: FlowRow[];
  scenes: Map<string, string>;
};
export function ShotScriptPanel({ projectId, libraryId, rows, scenes }: Props) {
  const storeKey = 'keco.shots.templates.v1:' + projectId;
  const [initial] = useState(() => {
    try {
      return { board: fromScript(rows, '当前剧本镜头', scenes), message: '' };
    } catch (e) {
      return {
        board: structuredClone(example),
        message: '当前 Script 无法导入，已打开示例：' + (e as Error).message,
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
  const [movie, setMovie] = useState('');
  const [run, restart] = useState(0);
  function readTemplates(): Template[] {
    const data = JSON.parse(localStorage.getItem(storeKey) ?? '[]');
    return data.map((t: Template) => ({
      id: t.id,
      board: checkBoard(t.board),
    }));
  }
  const shot = board.shots[index];
  function update(next: Storyboard) {
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
      const original = stored.find(t => t.id === active);
      const id = original?.board.name === saved.name ? active : crypto.randomUUID();
      if (stored.some(t => t.id !== id && t.board.name === saved.name)) {
        tell('此项目已有同名模板，请改名或先调用已有模板。');
        return;
      }
      const next = [
        ...stored.filter((t) => t.id !== id),
        { id, board: saved },
      ];
      localStorage.setItem(storeKey, JSON.stringify(next));
      list(next);
      setActive(id);
      select(id);
      tell('模板已保存，可在此项目中再次调用。');
    } catch {
      tell(
        '保存失败，请检查模板名称、选项文字、目标和镜头时长，或浏览器存储空间。',
      );
    }
  }
  function generate(download: boolean) {
    try {
      const html = sceneHtml(board);
      if (download) {
        const url = URL.createObjectURL(
          new Blob([html], { type: 'text/html;charset=utf-8' }),
        );
        const a = document.createElement('a');
        a.href = url;
        a.download = (board.name || '场景动画') + '.html';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      } else {
        setMovie(html);
        restart((n) => n + 1);
      }
      tell('');
    } catch {
      tell('请检查名称、分支目标、选项文字和时长后重新生成。');
    }
  }
  return (
    <section className={styles.panel} aria-label="镜头脚本">
      <h3>镜头脚本</h3>
      <div className={styles.bar}>
        <label>
          镜头模板
          <select value={choice} onChange={(e) => select(e.target.value)}>
            <option value="example">内置 · 门口的选择</option>
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
            tell('已载入镜头脚本。修改模板名称后保存，可创建新模板。');
          }}
        >
          调用模板
        </button>
        <button
          onClick={() => {
            try {
              load(fromScript(rows, '当前剧本镜头', scenes), '');
            } catch (e) {
              tell((e as Error).message);
            }
          }}
        >
          从当前 Script 载入
        </button>
      </div>
      <label>
        模板名称
        <input
          value={board.name}
          maxLength={100}
          onChange={(e) => update({ ...board, name: e.target.value })}
        />
      </label>
      <div className={styles.bar}>
        <label>
          当前镜头
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
          添加镜头
        </button>
      </div>
      <div className={styles.grid}>
        <label>
          场景
          <input
            value={shot.scene}
            onChange={(e) => edit({ scene: e.target.value })}
          />
        </label>
        <label>
          说话人
          <input
            placeholder="旁白"
            value={shot.speaker}
            onChange={(e) => edit({ speaker: e.target.value })}
          />
        </label>
      </div>
      <label>
        对白
        <textarea
          value={shot.line}
          onChange={(e) => edit({ line: e.target.value })}
        />
      </label>
      <div className={styles.grid}>
        <label>
          运镜
          <select
            value={shot.movement}
            onChange={(e) =>
              edit({ movement: e.target.value as Shot['movement'] })
            }
          >
            {movements.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label>
          时长（秒）
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
        <legend>动画标签</legend>
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
            {tag}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>下一镜 / 对话分支</legend>
        {shot.exits.length === 0 && <small>此镜头结束后停止播放。</small>}
        {shot.exits.map((exit, i) => (
          <div key={i} className={styles.bar}>
            <label>
              选项文字
              <input
                placeholder="留空表示自动转场"
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
              目标镜头
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
                <option value="">结束</option>
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
              移除
            </button>
          </div>
        ))}
        <button
          onClick={() =>
            edit({
              exits: [
                ...shot.exits,
                {
                  label: '选项 ' + (shot.exits.length + 1),
                  target: board.shots[index + 1]?.id ?? null,
                },
              ],
            })
          }
        >
          添加分支
        </button>
      </fieldset>
      <div className={styles.bar}>
        <button onClick={save}>保存模板</button>
        <button onClick={() => generate(false)}>生成并播放场景动画</button>
        <button onClick={() => generate(true)}>导出动画 HTML</button>
      </div>
      <span role="status">{message}</span>
      {movie && (
        <iframe
          key={libraryId + run}
          title="场景动画"
          sandbox="allow-scripts"
          srcDoc={movie}
        />
      )}
    </section>
  );
}
