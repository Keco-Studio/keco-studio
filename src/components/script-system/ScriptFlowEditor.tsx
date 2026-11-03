'use client';
import { useMemo, useRef, useState } from 'react';
import { applyFlowEdit, type FlowEdit } from '@/lib/script-system/flow-editing/edit';
import { analyzeFlow, flowText, optionIndexes, type FlowDiagnostic, type FlowRow } from '@/lib/script-system/flow-editing/model';
import styles from './ScriptFlowEditor.module.css';

type Snapshot = { rows: FlowRow[]; fingerprint: string; canEdit: boolean; diagnostics: FlowDiagnostic[] };
type Props = { projectId: string; libraryId: string; selectedRowIds: string[]; beforeOpen: () => Promise<boolean>; onSaved: () => void | Promise<void> };
export function ScriptFlowEditor({ projectId, libraryId, selectedRowIds, beforeOpen, onSaved }: Props) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rowId, setRowId] = useState('');
  const [outlet, setOutlet] = useState('ordinary');
  const [destination, setDestination] = useState('sequence');
  const [text, setText] = useState('');
  const [commands, setCommands] = useState('');
  const [remove, setRemove] = useState(false);
  const inFlight = useRef(false);
  const retry = useRef({ signature: '', requestId: '' });
  const endpoint = `/api/script-flow/${encodeURIComponent(projectId)}/${encodeURIComponent(libraryId)}`;
  const select = (data: Snapshot, sourceId: string, slot?: string) => {
    setRowId(sourceId); setRemove(false); setError('');
    const row = data.rows.find(r => r.id === sourceId);
    if (!row) return;
    const indexes = optionIndexes(row).filter(i => flowText(row.values[`Option${i}`]).trim());
    const chosen = slot ?? (indexes.length ? String(indexes[0]) : 'ordinary');
    setOutlet(chosen);
    const edge = analyzeFlow(data.rows).outlets.find(o => o.rowId === sourceId && (chosen === 'ordinary' ? o.kind !== 'option' : o.optionIndex === Number(chosen)));
    setDestination(edge?.kind === 'sequence' ? 'sequence' : edge?.targetRowId ?? 'end');
    setText(chosen === 'ordinary' ? '' : flowText(row.values[`Option${chosen}`]));
    setCommands(chosen === 'ordinary' ? '' : flowText(row.values[`Option${chosen}_Commands`]));
  };
  const open = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      if (!await beforeOpen()) throw new Error('Save the current dialogue draft before editing flow.');
      const response = await fetch(endpoint);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Unable to load flow');
      setSnapshot(data); select(data, selectedRowIds.find(id => data.rows.some((r: FlowRow) => r.id === id)) ?? data.rows[0]?.id ?? '');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); inFlight.current = false; }
  };
  const preview = useMemo(() => {
    if (!snapshot) return null;
    try {
      const target = destination === 'end' ? { kind: 'end' as const } : destination === 'sequence' ? { kind: 'sequence' as const } : { kind: 'row' as const, rowId: destination };
      let edit: FlowEdit;
      if (outlet === 'ordinary') edit = { type: 'outlet', rowId, target };
      else if (remove) edit = { type: 'delete-option', rowId, optionIndex: Number(outlet) };
      else {
        if (target.kind === 'sequence') throw new Error('Select a target or End for this option.');
        edit = { type: 'option', rowId, optionIndex: Number(outlet), text, commands, target };
      }
      const rows = applyFlowEdit(snapshot.rows, edit, () => 'preview-terminal');
      const changed = rows.filter(r => JSON.stringify(r.values) !== JSON.stringify(snapshot.rows.find(old => old.id === r.id)?.values));
      return { edit, changed, error: '' };
    } catch (e) { return { edit: null, changed: [], error: (e as Error).message }; }
  }, [snapshot, rowId, outlet, remove, destination, text, commands]);
  const save = async () => {
    if (inFlight.current || !snapshot || !preview?.edit || snapshot.diagnostics.length || !snapshot.canEdit) return;
    inFlight.current = true; setBusy(true); setError('');
    const payload = { expectedFingerprint: snapshot.fingerprint, edits: [preview.edit] };
    const signature = JSON.stringify(payload);
    if (retry.current.signature !== signature) retry.current = { signature, requestId: crypto.randomUUID() };
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, requestId: retry.current.requestId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Unable to save flow');
      await onSaved(); setSnapshot(null);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); inFlight.current = false; }
  };
  const source = snapshot?.rows.find(r => r.id === rowId);
  const indexes = source ? optionIndexes(source).filter(i => flowText(source.values[`Option${i}`]).trim()) : [];
  const newIndex = indexes.length ? Math.max(...indexes) + 1 : 0;
  return <section className={styles.editor} aria-label="Flow structure editor">
    {!snapshot ? <button type="button" disabled={busy} onClick={() => void open()}>{busy ? 'Loading flow…' : 'Edit flow'}</button> : <>
      <h3>Edit branch structure</h3>
      {!snapshot.canEdit ? <p>Read-only access</p> : null}
      {snapshot.diagnostics.map((d, i) => <p role="alert" key={`${d.rowId}-${d.field}-${i}`}>Row {snapshot.rows.findIndex(r => r.id === d.rowId) + 1} · {d.field}: {d.message}</p>)}
      <fieldset disabled={busy || !snapshot.canEdit}>
        <label>Source row<select aria-label="Source row" value={rowId} onChange={e => select(snapshot, e.target.value)}>{snapshot.rows.map((r, i) => <option key={r.id} value={r.id}>{i + 1}. {flowText(r.values.Name)} {flowText(r.values.Content).slice(0, 100) || '[End]'}</option>)}</select></label>
        {source?.values.If ? <p>Condition: {flowText(source.values.If)} (preserved; preview does not evaluate it)</p> : null}
        <label>Outlet<select aria-label="Outlet" value={outlet} onChange={e => select(snapshot, rowId, e.target.value)}>
          {!indexes.length && <option value="ordinary">Continue / Jump / End</option>}
          {indexes.map(i => <option key={i} value={String(i)}>Option {i}: {flowText(source?.values[`Option${i}`])}</option>)}
          <option value={String(newIndex)}>Add option {newIndex}</option>
        </select></label>
        {outlet !== 'ordinary' && <><label>Option text<input value={text} onChange={e => { setText(e.target.value); setRemove(false); }} /></label><label>Option commands<input value={commands} onChange={e => setCommands(e.target.value)} /></label></>}
        <label>Destination<select aria-label="Destination" value={destination} onChange={e => { setDestination(e.target.value); setRemove(false); }}>
          {outlet === 'ordinary' && <option value="sequence">Next row (physical order)</option>}
          <option value="end">End</option>
          {snapshot.rows.map((r, i) => <option key={r.id} value={r.id}>{i + 1}. {flowText(r.values.Label)} {flowText(r.values.Content).slice(0, 80) || '[End]'}</option>)}
        </select></label>
        {outlet !== 'ordinary' && indexes.includes(Number(outlet)) && <button type="button" onClick={() => setRemove(true)}>Delete this option</button>}
      </fieldset>
      {remove ? <p>This option button and its commands will be removed.</p> : null}
      {preview?.error ? <p role="alert">{preview.error}</p> : <details open><summary>Script changes ({preview?.changed.length ?? 0} rows)</summary><pre>{JSON.stringify(preview?.changed.map(r => {
        const index = snapshot.rows.findIndex(old => old.id === r.id);
        const old = snapshot.rows[index]?.values ?? {};
        return { row: index < 0 ? 'New ending' : index + 1, fields: Object.fromEntries(Object.entries(r.values).filter(([key, value]) => JSON.stringify(old[key]) !== JSON.stringify(value))) };
      }), null, 2)}</pre></details>}
      <div className={styles.actions}>
        {snapshot.canEdit && <button type="button" disabled={busy || Boolean(preview?.error) || !preview?.changed.length || snapshot.diagnostics.length > 0} onClick={() => void save()}>{busy ? 'Saving…' : 'Save flow'}</button>}
        <button type="button" disabled={busy} onClick={() => { setSnapshot(null); setError(''); }}>Cancel</button>
      </div>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
