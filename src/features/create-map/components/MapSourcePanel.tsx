import styles from '../CreateMapWorkbench.module.css';

export type MapSourceOption = { id: string; name: string };

type MapSourcePanelProps = {
  versionLabel?: 'V2' | 'V3';
  readOnly?: boolean;
  projects: MapSourceOption[];
  documents: MapSourceOption[];
  description: string;
  projectId: string;
  documentId: string;
  onDescriptionChange: (value: string) => void;
  onProjectChange: (id: string) => void;
  onDocumentChange: (id: string) => void;
  onCreatePlan: () => void;
  onSaveDraft: () => void;
  onGenerate: () => void;
  canSave: boolean;
  canGenerate: boolean;
  busy?: boolean;
  error?: string | null;
};

export function MapSourcePanel({
  versionLabel = 'V3',
  readOnly = false,
  projects,
  documents,
  description,
  projectId,
  documentId,
  onDescriptionChange,
  onProjectChange,
  onDocumentChange,
  onCreatePlan,
  onSaveDraft,
  onGenerate,
  canSave,
  canGenerate,
  busy = false,
  error = null,
}: MapSourcePanelProps) {
  return (
    <section className={styles.panelSection} aria-labelledby="map-source-heading">
      <div className={styles.sectionHeadingRow}>
        <div>
          <span className={styles.eyebrow}>Source</span>
          <h1 id="map-source-heading" className={styles.sectionTitle}>Create map</h1>
        </div>
        <span className={styles.draftBadge}>{versionLabel}</span>
      </div>

      <label className={styles.fieldLabel}>
        Description
        <textarea
          className={styles.textarea}
          value={description}
          maxLength={4000}
          rows={5}
          disabled={busy || readOnly}
          onChange={(event) => onDescriptionChange(event.target.value)}
        />
      </label>

      <label className={styles.fieldLabel}>
        Project <span className={styles.optionalLabel}>Optional</span>
        <select
          className={styles.select}
          value={projectId}
          disabled={busy || readOnly}
          onChange={(event) => onProjectChange(event.target.value)}
        >
          <option value="">No project</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </label>

      <label className={styles.fieldLabel}>
        Document <span className={styles.optionalLabel}>Optional</span>
        <select
          className={styles.select}
          value={documentId}
          disabled={!projectId || busy || readOnly}
          onChange={(event) => onDocumentChange(event.target.value)}
        >
          <option value="">No document</option>
          {documents.map((document) => <option key={document.id} value={document.id}>{document.name}</option>)}
        </select>
      </label>

      <button type="button" className={styles.primaryButton} disabled={!description.trim() || busy || readOnly} onClick={onCreatePlan}>
        {busy ? 'Working...' : 'Create map plan'}
      </button>
      <div className={styles.inlineActions}>
        <button type="button" className={styles.secondaryButton} disabled={!canSave || busy || readOnly} onClick={onSaveDraft}>Save draft</button>
        <button type="button" className={styles.primaryButton} disabled={!canGenerate || busy || readOnly} onClick={onGenerate}>Generate map</button>
      </div>
      {error ? <p className={styles.inlineError} role="alert">{error}</p> : null}
    </section>
  );
}
