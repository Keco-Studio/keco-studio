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

  useEffect(() => {
    setSelected(emptySelection());
    setMappings(emptyMappings());
    setSchemas({});
    setErrors([]);
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

  return (
    <section className={styles.flowScreen} aria-labelledby="simulation-import-title">
      <div className={styles.flowHeading}><div><span className={styles.kicker}>Studio data</span><h2 id="simulation-import-title">Import libraries</h2><p>Bind four project libraries, map their fields, then create an immutable local snapshot.</p></div></div>
      <label className={styles.fieldLabel}>Simulator name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <article className={styles.flowCard}>
        <h3>Demo data</h3>
        <p>Start immediately with the built-in character, skill, progression, and battle data.</p>
        <SimulationButton variant="primary" disabled={!selectedProjectId} onClick={useDemoData}>Use demo data</SimulationButton>
      </article>
      <div className={styles.flowHeading}><div><span className={styles.kicker}>Project libraries</span><h3>Import Studio data</h3></div></div>
      <div className={styles.importGrid}>
        {ROLES.map((role) => {
          const libraryId = selected[role];
          const fields = schemas[libraryId] ?? [];
          return <article className={styles.flowCard} key={role}>
            <label className={styles.fieldLabel}>{LABELS[role]}
              <select value={libraryId} onChange={(event) => void selectLibrary(role, event.target.value)}>
                <option value="">Select library</option>
                {libraries.map((library: Library) => <option key={library.id} value={library.id}>{library.name}</option>)}
              </select>
            </label>
            {libraryId ? <div className={styles.mappingList}>{SIM_FIELDS[role].map((field) => <label key={field.id} className={styles.mappingRow}>
              <span>{field.label}{field.required ? ' *' : ''}</span>
              <select value={mappings[role][field.id] ?? ''} onChange={(event) => mapField(role, field.id, event.target.value)}>
                <option value="">Not mapped</option>
                {fields.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}
              </select>
            </label>)}</div> : null}
          </article>;
        })}
      </div>
      {errors.length ? <div className={styles.errorList} role="alert"><strong>Import blocked</strong>{errors.map((error, index) => <p key={index}>{error.libraryName}{error.assetName ? ' / ' + error.assetName : ''} / {error.field}: {error.reason}</p>)}</div> : null}
      <SimulationButton variant="primary" loading={loading} disabled={!selectedProjectId || ROLES.some((role) => !selected[role])} onClick={() => void importLibraries()}>Import Studio data</SimulationButton>
    </section>
  );
}
