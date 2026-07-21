'use client';

import { useEffect, useState } from 'react';
import type { Library } from '@/lib/services/libraryService';
import { autoMapFields, createDemoImportedSnapshot, SIM_FIELDS } from '@/lib/simulation/data';
import { importSimulationSnapshot } from '@/lib/simulation/importAdapter';
import { useSimulationProject } from '@/lib/simulation/SimulationProjectProvider';
import { useSimulationSession } from '@/lib/simulation/SimulationSessionProvider';
import type { FieldMappings, LibraryRole, SimulationImportError } from '@/lib/simulation/types';
import { SimulationButton } from './SimulationButton';
import styles from './SimulationWorkbench.module.css';

const ROLES: readonly LibraryRole[] = ['characters', 'skills', 'level', 'skillc'];
const LABELS: Record<LibraryRole, string> = {
  characters: 'Characters', skills: 'Skills', level: 'Level curve', skillc: 'Skill cost curve',
};
const emptySelection = (): Record<LibraryRole, string> => ({ characters: '', skills: '', level: '', skillc: '' });
const emptyMappings = (): FieldMappings => ({ characters: {}, skills: {}, level: {}, skillc: {} });

export function ImportScreen() {
  const { selectedProjectId, libraries, loadFields, loadSources } = useSimulationProject();
  const { commitImport } = useSimulationSession();
  const [name, setName] = useState('New simulator');
  const [selected, setSelected] = useState(emptySelection);
  const [mappings, setMappings] = useState<FieldMappings>(emptyMappings);
  const [schemas, setSchemas] = useState<Record<string, Array<{ key: string; name: string }>>>({});
  const [errors, setErrors] = useState<readonly SimulationImportError[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeRole, setActiveRole] = useState<LibraryRole>('characters');

  useEffect(() => {
    setSelected(emptySelection());
    setMappings(emptyMappings());
    setSchemas({});
    setErrors([]);
    setActiveRole('characters');
  }, [selectedProjectId]);

  function useDemoData() {
    if (!selectedProjectId) return;
    commitImport(createDemoImportedSnapshot(selectedProjectId), name);
  }

  async function selectLibrary(role: LibraryRole, libraryId: string) {
    const next = { ...selected, [role]: libraryId };
    setSelected(next);
    if (!libraryId || !selectedProjectId) return;
    try {
      const fields = [...await loadFields(libraryId)];
      setSchemas((current) => ({ ...current, [libraryId]: fields }));
      const studioColumns = fields.map(({ key, name }) => ({ id: key, label: name }));
      setMappings((current) => ({ ...current, [role]: autoMapFields(role, current[role], studioColumns) }));
    } catch {
      // Full validation and source loading happens atomically on Import.
    }
  }

  function mapField(role: LibraryRole, canonical: string, fieldId: string) {
    setMappings((current) => {
      const roleMapping = { ...current[role] };
      for (const [key, value] of Object.entries(roleMapping)) if (value === fieldId) delete roleMapping[key];
      if (fieldId) roleMapping[canonical] = fieldId;
      else delete roleMapping[canonical];
      return { ...current, [role]: roleMapping };
    });
  }

  async function importLibraries() {
    if (!selectedProjectId || ROLES.some((role) => !selected[role])) return;
    setLoading(true);
    setErrors([]);
    try {
      const sources = await loadSources(selected);
      const result = importSimulationSnapshot({ sourceProjectId: selectedProjectId, sources, fieldMappings: mappings });
      if ('errors' in result) {
        setErrors(result.errors);
        return;
      }
      commitImport(result.snapshot, name);
    } catch (error) {
      setErrors([{
        role: 'characters', code: 'unresolved_reference', libraryId: '', libraryName: 'Studio', assetId: null,
        assetName: null, field: 'Libraries', reason: error instanceof Error ? error.message : 'Import failed.',
        message: error instanceof Error ? error.message : 'Import failed.',
      }]);
    } finally {
      setLoading(false);
    }
  }

  const activeLibraryId = selected[activeRole];
  const activeFields = schemas[activeLibraryId] ?? [];
  const activeDefinitions = SIM_FIELDS[activeRole];
  const mappedCount = Object.keys(mappings[activeRole]).length;

  return <section className={styles.flowScreen} aria-labelledby="simulation-import-title">
    <div className={styles.flowHeading}><div><h2 id="simulation-import-title">Import Studio libraries</h2><p>Select four Studio libraries, then connect their columns to simulation fields. Matching names auto-map and required fields stay visible.</p></div></div>
    <div className={styles.importTopRow}>
      <label className={styles.fieldLabel}>Simulator name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <div className={styles.demoCallout}><span><strong>Need a ready-to-play setup?</strong><small>Characters, skills and curves are included.</small></span><SimulationButton variant="primary" disabled={!selectedProjectId} onClick={useDemoData}>Use demo data</SimulationButton></div>
    </div>
    <div className={styles.importWorkbench}>
      <aside className={styles.libraryRail} aria-label="Import libraries">
        <span className={styles.sectionLabel}>Import libraries</span>
        {ROLES.map((role) => {
          const libraryId = selected[role];
          const missing = SIM_FIELDS[role].filter((field) => field.required && !mappings[role][field.id]).length;
          return <div className={`${styles.librarySlot} ${activeRole === role ? styles.librarySlotActive : ''}`} key={role}>
            <button type="button" onClick={() => setActiveRole(role)}><span>{LABELS[role]}</span><small>{libraryId ? `${Object.keys(mappings[role]).length} mapped` : 'Choose a source'}</small></button>
            <label className={styles.visuallyHidden} htmlFor={`simulation-library-${role}`}>{LABELS[role]}</label>
            <select id={`simulation-library-${role}`} value={libraryId} onFocus={() => setActiveRole(role)} onChange={(event) => { setActiveRole(role); void selectLibrary(role, event.target.value); }}><option value="">Select library</option>{libraries.map((library: Library) => <option key={library.id} value={library.id}>{library.name}</option>)}</select>
            {libraryId && missing ? <em>{missing} required fields missing</em> : null}
          </div>;
        })}
        <SimulationButton variant="primary" loading={loading} disabled={!selectedProjectId || ROLES.some((role) => !selected[role])} onClick={() => void importLibraries()}>Import Studio data</SimulationButton>
      </aside>
      <section className={styles.mappingBridge} aria-label={`${LABELS[activeRole]} field mapping`}>
        <header className={styles.mappingBridgeHeader}><span>Studio source table<small>{activeLibraryId ? libraries.find(({ id }) => id === activeLibraryId)?.name : 'Select a library'}</small></span><span>Simulation fields<small>{mappedCount}/{activeDefinitions.length} mapped</small></span></header>
        <div className={styles.sourceFieldList}>{activeFields.length ? activeFields.map((field) => <div className={styles.sourceField} key={field.key}><span>{field.name}</span><i aria-hidden="true">●</i></div>) : <p>Select a library on the left to view its source columns.</p>}</div>
        <div className={styles.mappingBridgeRail} aria-hidden="true">→</div>
        <div className={styles.targetFieldList}>{activeDefinitions.map((field) => <label className={styles.targetField} key={field.id}><span><i aria-hidden="true">●</i>{field.label}{field.required ? <b>*</b> : null}</span><select value={mappings[activeRole][field.id] ?? ''} onChange={(event) => mapField(activeRole, field.id, event.target.value)}><option value="">Connect a Studio column</option>{activeFields.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select></label>)}</div>
      </section>
    </div>
    {errors.length ? <div className={styles.errorList} role="alert"><strong>Import blocked</strong>{errors.map((error, index) => <p key={index}>{error.libraryName}{error.assetName ? ' / ' + error.assetName : ''} / {error.field}: {error.reason}</p>)}</div> : null}
  </section>;
}
