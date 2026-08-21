import {
  containsUnsafeDescriptionContent,
  DIRECT_MAP_UNSAFE_DESCRIPTION_MESSAGE,
} from '../model/directMapSchema';
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
  busy = false,
  error = null,
}: MapSourcePanelProps) {
  const descriptionInvalid = containsUnsafeDescriptionContent(description);
  const canCreatePlan = Boolean(projectId) && Boolean(documentId || description.trim()) && !descriptionInvalid;
  return (
    <section className={styles.panelSection} aria-labelledby="map-source-heading">
      <div className={styles.sectionHeadingRow}>
        <div>
          <span className={styles.eyebrow}>1 Source</span>
          <h1 id="map-source-heading" className={styles.sectionTitle}>Create map</h1>
        </div>
        <span className={styles.draftBadge}>{versionLabel}</span>
      </div>

      <label className={styles.fieldLabel}>
        Project
        <select
          className={styles.select}
          aria-label="Project"
          value={projectId}
          disabled={busy || readOnly}
          onChange={(event) => onProjectChange(event.target.value)}
        >
          <option value="">Select project</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </label>

      <label className={styles.fieldLabel}>
        Document <span className={styles.optionalLabel}>Optional</span>
        <select
          className={styles.select}
          aria-label="Document"
          value={documentId}
          disabled={!projectId || busy || readOnly}
          onChange={(event) => onDocumentChange(event.target.value)}
        >
          <option value="">No document</option>
          {documents.map((document) => <option key={document.id} value={document.id}>{document.name}</option>)}
        </select>
      </label>

      <label className={styles.fieldLabel}>
        Description <span className={styles.optionalLabel}>Optional with a Document</span>
        <textarea
          className={styles.textarea}
          aria-label="Description"
          value={description}
          placeholder="Optional additions or changes to the selected document"
          aria-invalid={descriptionInvalid || undefined}
          maxLength={4000}
          rows={5}
          disabled={busy || readOnly}
          onChange={(event) => onDescriptionChange(event.target.value)}
        />
      </label>
      {descriptionInvalid ? <p className={styles.inlineError} role="alert"><strong>Invalid.</strong> {DIRECT_MAP_UNSAFE_DESCRIPTION_MESSAGE}</p> : null}

      <button type="button" className={styles.primaryButton} disabled={!canCreatePlan || busy || readOnly} onClick={onCreatePlan}>
        {busy ? 'Working...' : 'Generate map plan'}
      </button>
      {error ? <p className={styles.inlineError} role="alert">{error}</p> : null}
    </section>
  );
}
