import { UploadOutlined } from '@ant-design/icons';
import type { MapPlanV3, MapReferenceV3 } from '../model/directMapSchema';
import type { MapReferenceRecord } from '../services/createMapService';
import styles from '../CreateMapWorkbench.module.css';

type StyleReference = MapPlanV3['styleReference'];

type MapReferencePanelProps = {
  projectId: string;
  records: MapReferenceRecord[];
  references: MapReferenceV3[];
  styleReference: StyleReference;
  busy: boolean;
  error: string | null;
  onReferencesChange: (references: MapReferenceV3[]) => void;
  onStyleReferenceChange: (reference: StyleReference) => void;
  onUpload: (file: File) => void;
};

const STYLE_COPY_OPTIONS = [
  ['color_palette', 'Palette'],
  ['outline', 'Outline'],
  ['detail', 'Detail'],
  ['shading', 'Shading'],
] as const;

export function MapReferencePanel(props: MapReferencePanelProps) {
  const selectedById = new Map(props.references.map((reference) => [reference.assetId, reference]));
  const atLimit = props.references.length >= 4;

  const toggleContentReference = (record: MapReferenceRecord, checked: boolean) => {
    if (!checked) {
      props.onReferencesChange(props.references.filter((reference) => reference.assetId !== record.id));
      return;
    }
    if (atLimit) return;
    props.onReferencesChange([...props.references, {
      assetId: record.id,
      sha256: record.sha256,
      role: 'content',
      usage: record.name,
    }]);
  };

  return (
    <section className={styles.panelSection} aria-labelledby="map-references-heading">
      <div className={styles.sectionHeadingRow}>
        <h2 id="map-references-heading" className={styles.sectionTitleSmall}>References</h2>
        <span className={styles.itemMeta}>{props.references.length} / 4</span>
      </div>

      <label className={styles.referenceUploadButton} aria-disabled={!props.projectId || props.busy}>
        <UploadOutlined /> Upload PNG
        <input
          type="file"
          accept="image/png"
          disabled={!props.projectId || props.busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) props.onUpload(file);
            event.target.value = '';
          }}
        />
      </label>

      {!props.projectId ? <p className={styles.savedMapsState}>Select a Project to manage private references.</p> : null}
      {props.error ? <p className={styles.inlineError} role="alert">{props.error}</p> : null}

      {props.records.length > 0 ? (
        <ul className={styles.referenceList} aria-label="Map references">
          {props.records.map((record) => {
            const selected = selectedById.get(record.id);
            const isStyle = props.styleReference?.assetId === record.id;
            return (
              <li key={record.id} className={styles.referenceItem}>
                {record.previewUrl
                  ? (
                    // Signed private previews must bypass the Next image proxy.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={record.previewUrl} alt="" width={48} height={48} />
                  )
                  : <span className={styles.referencePlaceholder} aria-hidden />}
                <div className={styles.referenceBody}>
                  <strong title={record.name}>{record.name}</strong>
                  <div className={styles.referenceModes}>
                    <label>
                      <input
                        type="checkbox"
                        checked={Boolean(selected)}
                        disabled={props.busy || (!selected && atLimit) || isStyle}
                        onChange={(event) => toggleContentReference(record, event.target.checked)}
                      /> Content
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={isStyle}
                        disabled={props.busy || Boolean(selected)}
                        onChange={(event) => props.onStyleReferenceChange(event.target.checked ? {
                          assetId: record.id,
                          sha256: record.sha256,
                          copy: ['color_palette'],
                        } : null)}
                      /> Style
                    </label>
                  </div>
                  {selected ? (
                    <div className={styles.referenceDetails}>
                      <select
                        className={styles.selectCompact}
                        aria-label={`${record.name} reference role`}
                        value={selected.role}
                        disabled={props.busy}
                        onChange={(event) => props.onReferencesChange(props.references.map((reference) =>
                          reference.assetId === record.id
                            ? { ...reference, role: event.target.value as 'content' | 'layout' }
                            : reference
                        ))}
                      >
                        <option value="content">Content</option>
                        <option value="layout">Layout</option>
                      </select>
                      <input
                        className={styles.inputCompact}
                        aria-label={`${record.name} usage`}
                        value={selected.usage}
                        maxLength={240}
                        disabled={props.busy}
                        onChange={(event) => props.onReferencesChange(props.references.map((reference) =>
                          reference.assetId === record.id ? { ...reference, usage: event.target.value } : reference
                        ))}
                      />
                    </div>
                  ) : null}
                  {isStyle ? (
                    <div className={styles.styleCopyOptions} aria-label="Style copy settings">
                      {STYLE_COPY_OPTIONS.map(([value, label]) => (
                        <label key={value}>
                          <input
                            type="checkbox"
                            checked={props.styleReference?.copy.includes(value) ?? false}
                            disabled={props.busy || (props.styleReference?.copy.length === 1 && props.styleReference.copy[0] === value)}
                            onChange={(event) => {
                              if (!props.styleReference) return;
                              const copy = event.target.checked
                                ? [...props.styleReference.copy, value]
                                : props.styleReference.copy.filter((entry) => entry !== value);
                              props.onStyleReferenceChange({ ...props.styleReference, copy });
                            }}
                          /> {label}
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
