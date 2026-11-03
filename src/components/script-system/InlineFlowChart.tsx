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
import styles from './ScriptFlowEditor.module.css';

type Snapshot = {
  rows: FlowRow[];
  fingerprint: string;
  canEdit: boolean;
  diagnostics: FlowDiagnostic[];
};
type Props = FlowChartPanelProps & {
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
  const [properties, setProperties] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const retry = useRef({ signature: '', id: '' });
  const released = useRef(false);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number }>();
  const load = useCallback(async () => {
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error('Could not load flow connections.');
    setData(await response.json());
  }, [endpoint]);
  useEffect(() => {
    void load().catch((e) => setMessage(e.message));
  }, [load]);
  const cancel = () => {
    setArmed(undefined);
    setSelected(undefined);
    setTargets([]);
    setCursor(undefined);
    pointer.current = null;
  };
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
  const editable = data?.canEdit && !data.diagnostics.length;
  const currentNode = chart.graph.nodes.find(
    (n) => n.id === chart.selectedPlotNodeId,
  );
  return (
    <div
      className={styles.inlineChart}
      onKeyDown={(e) => {
        if (
          (e.target as HTMLElement).closest(
            'input,textarea,select,[contenteditable=true]',
          )
        )
          return;
        if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
          setMessage('');
        } else if (selected && (e.key === 'Delete' || e.key === 'Backspace')) {
          e.preventDefault();
          void save(selected, { kind: 'end' });
        }
      }}
    >
      <FlowChartPanel
        {...chart}
        tools={
          <div className={styles.wireTools}>
            <span role="status">
              {busy
                ? 'Saving…'
                : message ||
                  (targets.length
                    ? 'Choose a row in this scene'
                    : armed
                      ? 'Choose an input · Esc to cancel'
                      : selected
                        ? 'Delete to disconnect'
                        : editable
                          ? 'Connect pins · Alt-click a wire to disconnect'
                          : '')}
            </span>
            {selected && (
              <button
                disabled={busy}
                onClick={() => void save(selected, { kind: 'end' })}
              >
                Disconnect
              </button>
            )}
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
            {editable && currentNode && (
              <details>
                <summary>Node properties</summary>
                <button onClick={() => setProperties((v) => !v)}>
                  Options and commands
                </button>
                {properties && (
                  <ScriptFlowEditor
                    projectId={projectId}
                    libraryId={libraryId}
                    selectedRowIds={currentNode.rowIndexes.map(
                      (i) => rowIds[i],
                    )}
                    beforeOpen={beforeOpen}
                    onSaved={async () => {
                      await onSaved();
                      await load();
                      setProperties(false);
                    }}
                    inlineProperties
                    onDismiss={() => setProperties(false)}
                  />
                )}
              </details>
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
