'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  analyzeFlow,
  flowText,
  type FlowDiagnostic,
  type FlowOutlet,
  type FlowRow,
} from '@/lib/script-system/flow-editing/model';
import type {
  FlowEdit,
  FlowTarget,
} from '@/lib/script-system/flow-editing/edit';
import { FlowChartPanel, type FlowChartPanelProps } from './FlowChartPanel';
import { ScriptFlowEditor } from './ScriptFlowEditor';
import { copyRows } from '@/lib/script-system/flow-editing/clipboard';
import {
  parseScriptReuseSnapshot,
  type ScriptReuseSnapshot,
} from '@/lib/script-system/reuse/schema';
import styles from './ScriptFlowEditor.module.css';
import toolbar from './ScriptWorkspaceToolbar.module.css';

type Snapshot = {
  rows: FlowRow[];
  fingerprint: string;
  canEdit: boolean;
  diagnostics: FlowDiagnostic[];
};
type Props = FlowChartPanelProps & {
  sourceVersion?: string;
  duplicateUrl?: (id: string) => string;
  characters?: string[];
  onInsertDialogue?: (speaker: string) => Promise<boolean>;
  projectId: string;
  libraryId: string;
  rowIds: string[];
  beforeOpen: () => Promise<boolean>;
  onSaved: () => void | Promise<void>;
};
const key = (pin: FlowOutlet) =>
  pin.rowId + ':' + (pin.optionIndex ?? 'ordinary');
const name = (pin: FlowOutlet) => pin.text || 'Continue';

export function InlineFlowChart({
  sourceVersion, duplicateUrl,
  characters = [],
  onInsertDialogue,
  projectId,
  libraryId,
  rowIds,
  beforeOpen,
  onSaved,
  ...chart
}: Props) {
  const endpoint = `/api/script-flow/${projectId}/${libraryId}`;
  const [data, setData] = useState<Snapshot>();
  const [armed, setArmed] = useState<FlowOutlet>();
  const [selected, setSelected] = useState<FlowOutlet>();
  const [targets, setTargets] = useState<string[]>([]);
  const [properties, setProperties] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(
    null,
  );
  const [adding, setAdding] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector('button')?.focus();
    const dismiss = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [menu]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const undoIds=useRef<string[]>([]);
  const remember=(id:string)=>{undoIds.current=[...undoIds.current.filter(x=>x!==id),id].slice(-20);};
  const retry = useRef({ signature: '', id: '' });
  const released = useRef(false);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number }>();
  const load = useCallback(async () => {
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error('Could not load flow connections.');
    setData(await response.json());
  }, [endpoint]);
  const rowSignature = rowIds.join('|');
  useEffect(() => {
    void load().catch((e) => setMessage(e.message));
  }, [load, rowSignature, sourceVersion]);
  const cancel = () => {
    setArmed(undefined);
    setSelected(undefined);
    setTargets([]);
    setCursor(undefined);
    pointer.current = null;
  };
  const surface = useRef<HTMLDivElement>(null);
  const buffer = useRef<ScriptReuseSnapshot | null>(null);
  const [marked, setMarked] = useState<string[]>([]);
  const clipType = 'application/x-keco-script';
  const currentIds = (nodeId = chart.selectedPlotNodeId) => {
    const ids = marked.includes(nodeId) ? marked : [nodeId];
    return chart.graph.nodes
      .filter((n) => ids.includes(n.id))
      .flatMap((n) => n.rowIndexes.map((i) => rowIds[i]));
  };
  function capture(ids: string[]) {
    if (!data) throw new Error('Script is still loading.');
    const fragment = copyRows(
      projectId,
      libraryId,
      data.rows,
      ids,
      chart.graph.nodes.map((n) => ({
        localId: n.id,
        title: n.label,
        rowIds: n.rowIndexes.map((i) => rowIds[i]),
      })),
    );
    buffer.current = fragment;
    return fragment;
  }
  async function place(fragment: ScriptReuseSnapshot) {
    if (!data?.canEdit || locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      if (!(await beforeOpen())) throw new Error('Save the dialogue first.');
      const payload = { fragment, expectedFingerprint: data.fingerprint };
      const signature = JSON.stringify(payload);
      if (retry.current.signature !== signature)
        retry.current = { signature, id: crypto.randomUUID() };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, requestId: retry.current.id }),
      });
      if (!res.ok) {
        if (res.status === 409) await load();
        throw new Error((await res.json()).error || 'Paste failed');
      }
      remember(retry.current.id);
      surface.current?.focus();
      await onSaved();
      await load();
      retry.current = { signature: '', id: '' };
      setMessage('Independent copy created');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function duplicateWhole() {
    setMenu(null);
    if (!data || locked.current) return;
    const name = window.prompt('New Script name');
    if (!name?.trim()) return;
    locked.current = true;
    setBusy(true);
    try {
      if (!(await beforeOpen())) throw new Error('Save the dialogue first.');
      const payload = {
        duplicateScript: name.trim(),
        expectedFingerprint: data.fingerprint,
      };
      const signature = JSON.stringify(payload);
      if (retry.current.signature !== signature)
        retry.current = { signature, id: crypto.randomUUID() };
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, requestId: retry.current.id }),
      });
      const result = await response.json();
      if (!response.ok || !result.libraryId)
        throw new Error(result.error || 'Could not create a copy');
      window.location.assign(
        duplicateUrl?.(result.libraryId) ??
          `/script-system/${projectId}/script/${result.libraryId}`,
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function menuCopy(id: string, duplicate: boolean) {
    setMenu(null);
    try {
      const fragment = capture(currentIds(id));
      if (duplicate) await place(fragment);
      else {
        // Native Ctrl+C writes both flavors. A menu copy also remains available
        // when system clipboard access is unavailable.
        if (navigator.clipboard?.writeText)
          await navigator.clipboard
            .writeText(
              fragment.rows
                .map((r) => String(r.values.Content ?? ''))
                .join('\n'),
            )
            .catch(() => {});
        setMessage(`Copied ${fragment.rows.length} rows. Paste them into the graph.`);
      }
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  useEffect(() => {
    function copy(e: ClipboardEvent) {
      const el = e.target as HTMLElement;
      if (
        el.closest?.('textarea,input,[contenteditable=true]') ||
        !e.clipboardData
      )
        return;
      const range = window.getSelection();
      const chartFocused = surface.current?.contains(el);
      const scope = surface.current?.closest('[data-script-copy-scope]');
      const ids =
        range?.rangeCount &&
        !range.isCollapsed &&
        scope?.contains(range.anchorNode) &&
        scope.contains(range.focusNode)
          ? Array.from(
              scope.querySelectorAll<HTMLElement>('[data-script-clip-rows]'),
            )
              .filter((n) => range.getRangeAt(0).intersectsNode(n))
              .flatMap((n) => n.dataset.scriptClipRows!.split(' '))
          : [];
      if (!ids.length && !chartFocused) return;
      try {
        const frag = capture(ids.length ? ids : currentIds());
        e.clipboardData.setData(clipType, JSON.stringify(frag));
        e.clipboardData.setData(
          'text/plain',
          ids.length
            ? range!.toString()
            : frag.rows.map((r) => String(r.values.Content ?? '')).join('\n'),
        );
        e.preventDefault();
        setMessage(`Copied ${frag.rows.length} rows`);
      } catch (err) {
        setMessage((err as Error).message);
      }
    }
    function paste(e: ClipboardEvent) {
      const el = e.target as HTMLElement;
      if (
        !surface.current?.contains(el) ||
        el.closest?.('textarea,input,[contenteditable=true]')
      )
        return;
      try {
        const raw = e.clipboardData?.getData(clipType);
        const plain = e.clipboardData?.getData('text/plain');
        const fragment = raw
          ? parseScriptReuseSnapshot(JSON.parse(raw))
          : buffer.current &&
              plain ===
                buffer.current.rows
                  .map((r) => String(r.values.Content ?? ''))
                  .join('\n')
            ? buffer.current
            : undefined;
        if (fragment) {
          e.preventDefault();
          void place(fragment);
        }
      } catch (err) {
        setMessage((err as Error).message);
      }
    }
    document.addEventListener('copy', copy);
    document.addEventListener('paste', paste);
    return () => {
      document.removeEventListener('copy', copy);
      document.removeEventListener('paste', paste);
    };
  });
  const pins = useMemo(() => {
    const groups = new Map<string, FlowOutlet[]>();
    if (!data) return groups;
    const owners = new Map(
      chart.graph.nodes.flatMap((node) =>
        node.rowIndexes.map((i) => [rowIds[i], node.id] as const),
      ),
    );
    for (const pin of analyzeFlow(data.rows).outlets) {
      const owner = owners.get(pin.rowId);
      if (!owner) continue;
      const list = groups.get(owner) ?? [];
      list.push(pin);
      groups.set(owner, list);
    }
    return groups;
  }, [data, chart.graph, rowIds]);
  async function save(
    pin: FlowOutlet,
    target: Exclude<FlowTarget, { kind: 'sequence' }>,
  ) {
    if (locked.current || !data?.canEdit || data.diagnostics.length) return;
    locked.current = true;
    setBusy(true);
    const edit: FlowEdit =
      pin.optionIndex === undefined
        ? { type: 'outlet', rowId: pin.rowId, target }
        : target.kind === 'end'
          ? { type: 'disconnect-option', rowId: pin.rowId, optionIndex: pin.optionIndex }
          : {
            type: 'option',
            rowId: pin.rowId,
            optionIndex: pin.optionIndex,
            text: pin.text!,
            target,
          };
    const payload = { expectedFingerprint: data.fingerprint, edits: [edit] };
    const signature = JSON.stringify(payload);
    if (retry.current.signature !== signature)
      retry.current = { signature, id: crypto.randomUUID() };
    try {
      if (!(await beforeOpen()))
        throw new Error('Save the dialogue draft first.');
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, requestId: retry.current.id }),
      });
      if (!response.ok) {
        if (response.status === 409) {
          cancel();
          await load();
        }
        throw new Error(
          (await response.json()).error || 'Connection could not be saved.',
        );
      }
      cancel();
      remember(retry.current.id);
      surface.current?.focus();
      await onSaved();
      await load();
      setMessage('Saved');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  function land(ids: string[]) {
    if (!armed || !ids.length || locked.current) return;
    if (ids.length === 1) void save(armed, { kind: 'row', rowId: ids[0] });
    else {
      setTargets(ids);
      setCursor(undefined);
    }
  }
  async function undoFlow(){
    const id=undoIds.current.at(-1);
    if(!id || locked.current)return;
    locked.current=true;setBusy(true);
    try {
      if(!await beforeOpen())throw Error('Save the dialogue first');
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({undoRequestId:id})});
      if(!response.ok)throw Error(response.status===409?'The Script has changed. Undo would overwrite a later edit.':'Undo failed');
      undoIds.current.pop();cancel();await onSaved();await load();setMessage('Flow edit undone');
    }catch(e){setMessage((e as Error).message);}finally{locked.current=false;setBusy(false);}
  }
  const editable = data?.canEdit && !data.diagnostics.length;
  const currentNode = chart.graph.nodes.find((n) => n.id === properties);
  return (
    <div
      className={styles.inlineChart}
      ref={surface}
      tabIndex={0}
      onKeyDown={(e) => {
        if (
          (e.target as HTMLElement).closest(
            'input,textarea,select,[contenteditable=true]',
          )
        )
          return;
        if(!e.shiftKey && (e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='z'){e.preventDefault();void undoFlow();return;}
        if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
          setMenu(null);
          setProperties(null);
          setMessage('');
        } else if (selected && (e.key === 'Delete' || e.key === 'Backspace')) {
          e.preventDefault();
          void save(selected, { kind: 'end' });
        }
      }}
    >
      <FlowChartPanel
        key={endpoint}
        layoutKey={endpoint}
        {...chart}
        markedNodes={marked}
        onSelectPlotNode={(id) => {
          setMarked([]);
          chart.onSelectPlotNode(id);
        }}
        onToggleMarked={(id) =>
          setMarked((old) => {
            const previous = old.length ? old : [chart.selectedPlotNodeId];
            return previous.includes(id)
              ? previous.filter((n) => n !== id)
              : [...previous, id];
          })
        }
        onNodeMenu={
          editable
            ? (id, x, y) => {
                cancel();
                setProperties(null);
                setAdding(false);
                chart.onSelectPlotNode(id);
                setMenu({
                  id,
                  x: Math.max(0, Math.min(x, window.innerWidth - 224)),
                  y: Math.max(0, Math.min(y, window.innerHeight - 190)),
                });
              }
            : undefined
        }
        tools={
          <div className={styles.wireTools}>
            <div className={styles.wireActionRow}>
            {undoIds.current.length>0 && <button className={toolbar.button} disabled={busy} onClick={()=>void undoFlow()}>Undo flow edit</button>}
            <span role="status">
              {busy
                ? 'Saving…'
                : message ||
                  (targets.length
                    ? 'Choose a row in this scene'
                    : armed
                      ? 'Choose an input · Esc to cancel'
                      : selected
                        ? 'Connection selected'
                        : editable
                          ? 'Connect pins · Alt-click a wire to disconnect'
                          : '')}
            </span>
            {selected && (
              <button
                type="button"
                className={toolbar.button}
                title="Disconnect the selected wire (Delete)"
                aria-keyshortcuts="Delete Backspace"
                disabled={busy}
                onClick={() => void save(selected, { kind: 'end' })}
              >
                Disconnect
              </button>
            )}
            </div>
            {targets.map((id) => (
              <button
                key={id}
                onClick={() =>
                  armed && void save(armed, { kind: 'row', rowId: id })
                }
              >
                {flowText(
                  data?.rows.find((r) => r.id === id)?.values.Content,
                ) || id}
              </button>
            ))}
            {menu && (
              <div
                ref={menuRef}
                role="menu"
                aria-label="Node actions"
                className={styles.nodeMenu}
                style={{ left: menu.x, top: menu.y }}
              >
                <button
                  role="menuitem"
                  onClick={() => {
                    setProperties(menu.id);
                    setMenu(null);
                  }}
                >
                  Node properties
                </button>
                <button
                  role="menuitem"
                  disabled={busy}
                  onClick={() => void duplicateWhole()}
                >
                  Duplicate Script…
                </button>
                <button
                  role="menuitem"
                  onClick={() => void menuCopy(menu.id, false)}
                >
                  Copy selected nodes
                </button>
                <button
                  role="menuitem"
                  disabled={!buffer.current || busy}
                  onClick={() => {
                    setMenu(null);
                    if (buffer.current) void place(buffer.current);
                  }}
                >
                  Paste nodes
                </button>
                <button
                  role="menuitem"
                  disabled={busy}
                  onClick={() => void menuCopy(menu.id, true)}
                >
                  Duplicate nodes
                </button>
                {onInsertDialogue && (
                  <button role="menuitem" onClick={() => setAdding((v) => !v)}>
                    Add dialogue after this node…
                  </button>
                )}
                {adding &&
                  characters.map((speaker) => (
                    <button
                      role="menuitem"
                      key={speaker}
                      onClick={async () => {
                        setMenu(null);
                        try {
                          if (
                            (await beforeOpen()) &&
                            (await onInsertDialogue?.(speaker))
                          ) {
                            await load();
                            setMessage('Dialogue added');
                          } else setMessage('Could not insert dialogue');
                        } catch (e) {
                          setMessage((e as Error).message);
                        }
                      }}
                    >
                      {speaker}
                    </button>
                  ))}
                {adding && !characters.length && (
                  <span>Add a character to the Script first.</span>
                )}
              </div>
            )}
            {editable && currentNode && (
              <ScriptFlowEditor
                key={currentNode.id}
                projectId={projectId}
                libraryId={libraryId}
                selectedRowIds={currentNode.rowIndexes.map((i) => rowIds[i])}
                beforeOpen={beforeOpen}
                inlineProperties
                onSaved={async (id) => {
                    if(id)remember(id);
                  await onSaved();
                  await load();
                  setProperties(null);
                }}
                onDismiss={() => setProperties(null)}
              />
            )}
            {data?.diagnostics.map((d, i) => (
              <span key={i} role="alert">
                {d.field}: {d.message}
              </span>
            ))}
          </div>
        }
        renderWiring={
          !editable
            ? undefined
            : (positions) => {
                const owner = new Map(
                  chart.graph.nodes.flatMap((n) =>
                    n.rowIndexes.map((i) => [rowIds[i], n.id] as const),
                  ),
                );
                return (
                  <g
                    onPointerMove={(e) => {
                      if (!armed) return;
                      const svg = e.currentTarget.ownerSVGElement,
                        matrix = svg?.getScreenCTM();
                      if (matrix)
                        setCursor(
                          new DOMPoint(e.clientX, e.clientY).matrixTransform(
                            matrix.inverse(),
                          ),
                        );
                    }}
                  >
                    {armed && (
                      <rect
                        width="100%"
                        height="100%"
                        fill="transparent"
                        onClick={() => {
                          cancel();
                          setMessage('');
                        }}
                      />
                    )}
                    {[...pins].map(([node, list]) => {
                      const pos = positions.get(node);
                      if (!pos) return null;
                      return (
                        <g key={node}>
                          {list.map((pin, i) => {
                            const x =
                                pos.x + (180 * (i + 1)) / (list.length + 1),
                              y = pos.y + 48;
                            const destNode = owner.get(pin.targetRowId ?? ''),
                              dest = destNode && positions.get(destNode);
                            const isArmed = armed && key(armed) === key(pin);
                            const isSelected =
                              selected && key(selected) === key(pin);
                            const label = `Row ${rowIds.indexOf(pin.rowId) + 1}: ${name(pin)}`;
                            function arm() {
                              setArmed(pin);
                              setSelected(undefined);
                              setCursor(undefined);
                              setTargets([]);
                              setMessage('');
                            }
                            const path =
                              dest &&
                              (destNode === node
                                ? `M ${x} ${y} C ${x + 100} ${y + 55}, ${x + 120} ${dest.y - 50}, ${dest.x + 90} ${dest.y}`
                                : `M ${x} ${y} C ${x} ${y + 48}, ${dest.x + 90} ${dest.y - 48}, ${dest.x + 90} ${dest.y}`);
                            return (
                              <g key={key(pin)}>
                                {path &&
                                  !(
                                    pin.kind === 'sequence' && destNode === node
                                  ) && (
                                    <g
                                      role="button"
                                      tabIndex={0}
                                      aria-label={`Connection ${label}`}
                                      className={styles.wire}
                                      onClick={(e) => {
                                        e.currentTarget.focus();
                                        cancel();
                                        if (e.altKey)
                                          void save(pin, { kind: 'end' });
                                        else setSelected(pin);
                                      }}
                                      onKeyDown={(e) => {
                                        if (
                                          e.key === 'Enter' ||
                                          e.key === ' '
                                        ) {
                                          e.preventDefault();
                                          cancel();
                                          setSelected(pin);
                                        }
                                      }}
                                    >
                                      <path
                                        d={path}
                                        fill="none"
                                        stroke={
                                          isSelected ? '#007aff' : '#859ab0'
                                        }
                                        strokeWidth={isSelected ? 3 : 2}
                                      />
                                      <path
                                        d={path}
                                        fill="none"
                                        stroke="transparent"
                                        strokeWidth="14"
                                      />
                                      <title>{label}</title>
                                      {pin.text && dest && (
                                        <text
                                          x={(x + dest.x + 90) / 2}
                                          y={(y + dest.y) / 2 - 4}
                                          textAnchor="middle"
                                          fontSize="11"
                                        >
                                          {pin.text}
                                        </text>
                                      )}
                                    </g>
                                  )}
                                {isArmed && cursor && (
                                  <path
                                    pointerEvents="none"
                                    d={`M ${x} ${y} Q ${x} ${y + 30}, ${cursor.x} ${cursor.y}`}
                                    fill="none"
                                    stroke="#007aff"
                                    strokeDasharray="4 3"
                                  />
                                )}
                                <circle
                                  role="button"
                                  tabIndex={0}
                                  aria-label={`Output ${label}`}
                                  cx={x}
                                  cy={y}
                                  r={6}
                                  className={styles.socket}
                                  fill={isArmed ? '#007aff' : 'white'}
                                  onPointerDown={(e) => {
                                    if (e.button !== 0) return;
                                    e.currentTarget.focus();
                                    released.current = false;
                                    pointer.current = {
                                      x: e.clientX,
                                      y: e.clientY,
                                    };
                                    arm();
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === ' ' || e.key === 'Enter') {
                                      e.preventDefault();
                                      arm();
                                    }
                                  }}
                                >
                                  <title>{label}</title>
                                </circle>
                              </g>
                            );
                          })}
                        </g>
                      );
                    })}
                    {chart.graph.nodes.map((n) => {
                      const pos = positions.get(n.id);
                      if (!pos) return null;
                      const ids = n.rowIndexes
                        .map((i) => rowIds[i])
                        .filter(Boolean);
                      return (
                        <circle
                          key={n.id}
                          role="button"
                          tabIndex={0}
                          aria-label={`Input ${n.label}`}
                          cx={pos.x + 90}
                          cy={pos.y}
                          r={7}
                          fill={armed ? '#d8eeff' : 'white'}
                          className={styles.socket}
                          onPointerUp={(e) => {
                            if (
                              pointer.current &&
                              Math.hypot(
                                e.clientX - pointer.current.x,
                                e.clientY - pointer.current.y,
                              ) > 3
                            ) {
                              released.current = true;
                              pointer.current = null;
                              land(ids);
                            }
                          }}
                          onClick={() => {
                            if (!released.current) land(ids);
                            released.current = false;
                          }}
                          onKeyDown={(e) => {
                            if (e.key === ' ' || e.key === 'Enter') {
                              e.preventDefault();
                              land(ids);
                            }
                          }}
                        >
                          <title>Connect to {n.label}</title>
                        </circle>
                      );
                    })}
                  </g>
                );
              }
        }
      />
    </div>
  );
}
