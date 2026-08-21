import { DIRECT_MAP_PROFILES, type MapPlanV3, type MapPlanV3Issue } from '../model/directMapSchema';
import styles from '../CreateMapWorkbench.module.css';

type DirectMapPlanInspectorProps = {
  plan: MapPlanV3;
  issues: MapPlanV3Issue[];
  onChange: (plan: MapPlanV3) => void;
  disabled?: boolean;
};

export function DirectMapPlanInspector({ plan, issues, onChange, disabled = false }: DirectMapPlanInspectorProps) {
  const profileValue = `${plan.map.width}x${plan.map.height}`;
  const descriptionIssues = issues.filter((issue) => issue.path[0] === 'description');

  return (
    <section className={styles.inspectorSection} aria-labelledby="direct-plan-heading">
      <div className={styles.sectionHeadingRow}>
        <div>
          <span className={styles.eyebrow}>2 Review plan</span>
          <h2 id="direct-plan-heading" className={styles.sectionTitleSmall}>Map plan</h2>
        </div>
        <span className={issues.length > 0 ? styles.issueCount : styles.validCount}>
          {issues.length > 0 ? `${issues.length} issues` : 'Valid'}
        </span>
      </div>

      <label className={styles.fieldLabel}>
        Name
        <input
          className={styles.input}
          value={plan.name}
          maxLength={160}
          disabled={disabled}
          onChange={(event) => onChange({ ...plan, name: event.target.value })}
        />
      </label>

      <label className={styles.fieldLabel}>
        Summary
        <textarea
          className={styles.textareaCompact}
          value={plan.summary}
          maxLength={500}
          rows={2}
          disabled={disabled}
          onChange={(event) => onChange({ ...plan, summary: event.target.value })}
        />
      </label>

      <label className={styles.fieldLabel}>
        Output profile
        <select
          className={styles.select}
          aria-label="Output profile"
          value={profileValue}
          disabled={disabled}
          onChange={(event) => {
            const profile = DIRECT_MAP_PROFILES.find(({ width, height }) => `${width}x${height}` === event.target.value);
            if (profile) onChange({ ...plan, map: { width: profile.width, height: profile.height } });
          }}
        >
          {DIRECT_MAP_PROFILES.map(({ width, height }) => (
            <option key={`${width}x${height}`} value={`${width}x${height}`}>{width} × {height}</option>
          ))}
        </select>
      </label>

      <label className={styles.fieldLabel}>
        <span className={styles.fieldLabelRow}>
          <span>PixelLab description</span>
          <span className={styles.characterCount}>{plan.description.length} / 2000</span>
        </span>
        <textarea
          className={styles.directDescription}
          aria-label="PixelLab description"
          aria-invalid={descriptionIssues.length > 0 || undefined}
          value={plan.description}
          maxLength={2000}
          rows={10}
          disabled={disabled}
          onChange={(event) => onChange({ ...plan, description: event.target.value })}
        />
      </label>
      {descriptionIssues.map((issue, index) => (
        <p key={`${issue.code}-${index}`} className={styles.fieldError}>{issue.message}</p>
      ))}

      <label className={styles.fieldLabel}>
        Seed <span className={styles.optionalLabel}>Optional</span>
        <input
          className={styles.input}
          type="number"
          min={0}
          step={1}
          value={plan.generation.seed ?? ''}
          disabled={disabled}
          onChange={(event) => onChange({
            ...plan,
            generation: {
              ...plan.generation,
              seed: event.target.value === '' ? null : Math.max(0, Math.trunc(Number(event.target.value))),
            },
          })}
        />
      </label>

      {issues.filter((issue) => issue.path[0] !== 'description').length > 0 ? (
        <ul className={styles.compactIssueList} aria-label="Map Plan issues">
          {issues.filter((issue) => issue.path[0] !== 'description').map((issue, index) => (
            <li key={`${issue.code}-${index}`}>{issue.message}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
