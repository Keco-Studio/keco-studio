import type { MapPlanCommand } from '../model/mapPlanReducer';
import type { MapPlanV2, MapPlanV2Issue } from '../model/mapPlanSchema';
import type { MapPlanSelection } from './PlanReviewCanvas';
import styles from '../CreateMapWorkbench.module.css';

type MapPlanInspectorProps = {
  plan: MapPlanV2;
  selection: MapPlanSelection;
  issues: MapPlanV2Issue[];
  onCommand: (command: MapPlanCommand) => void;
};

function startsWithPath(path: Array<string | number>, prefix: Array<string | number>): boolean {
  return prefix.every((segment, index) => path[index] === segment);
}

export function MapPlanInspector({ plan, selection, issues, onCommand }: MapPlanInspectorProps) {
  const updatePlan = (next: MapPlanV2) => onCommand({ type: 'plan/update', plan: next });
  const updateMap = (values: Partial<MapPlanV2['map']>) => {
    updatePlan({ ...plan, map: { ...plan.map, ...values } });
  };
  const pathIndex = selection?.kind === 'path'
    ? plan.background.paths.findIndex((item) => item.id === selection.id)
    : -1;
  const regionIndex = selection?.kind === 'region'
    ? plan.background.regions.findIndex((item) => item.id === selection.id)
    : -1;
  const placementIndex = selection?.kind === 'placement'
    ? plan.obstaclePlacements.findIndex((item) => item.id === selection.id)
    : -1;
  const path = pathIndex >= 0 ? plan.background.paths[pathIndex] : null;
  const region = regionIndex >= 0 ? plan.background.regions[regionIndex] : null;
  const placement = placementIndex >= 0 ? plan.obstaclePlacements[placementIndex] : null;

  const issueAt = (prefix: Array<string | number>) => issues.find((issue) => startsWithPath(issue.path, prefix));
  const fieldIssue = (id: string, prefix: Array<string | number>) => {
    const issue = issueAt(prefix);
    return issue ? <span id={id} className={styles.fieldError}>{issue.message}</span> : null;
  };
  const selectedIssuePrefix = regionIndex >= 0
    ? ['background', 'regions', regionIndex]
    : pathIndex >= 0
      ? ['background', 'paths', pathIndex]
      : placementIndex >= 0
        ? ['obstaclePlacements', placementIndex]
        : null;
  const selectedIssues = selectedIssuePrefix
    ? issues.filter((issue) => startsWithPath(issue.path, selectedIssuePrefix))
    : issues;

  const nameIssue = issueAt(['name']);
  const widthIssue = issueAt(['map', 'width']);
  const heightIssue = issueAt(['map', 'height']);
  const visualBriefIssue = issueAt(['visualBrief']);

  return (
    <section className={styles.inspectorSection} aria-labelledby="map-plan-heading">
      <div className={styles.sectionHeadingRow}>
        <h2 id="map-plan-heading" className={styles.sectionTitleSmall}>Map plan</h2>
        <span className={issues.length ? styles.issueCount : styles.validCount}>
          {issues.length ? `${issues.length} issues` : 'Valid'}
        </span>
      </div>

      <label className={styles.fieldLabel}>
        Name
        <input
          className={styles.input}
          value={plan.name}
          aria-invalid={nameIssue ? true : undefined}
          aria-describedby={nameIssue ? 'map-name-error' : undefined}
          onChange={(event) => updatePlan({ ...plan, name: event.target.value })}
        />
        {fieldIssue('map-name-error', ['name'])}
      </label>
      <div className={styles.twoColumnFields}>
        <label className={styles.fieldLabel}>
          Width
          <input
            className={styles.input}
            type="number"
            min="1"
            value={plan.map.width}
            aria-invalid={widthIssue ? true : undefined}
            aria-describedby={widthIssue ? 'map-width-error' : undefined}
            onChange={(event) => updateMap({ width: Number(event.target.value) })}
          />
          {fieldIssue('map-width-error', ['map', 'width'])}
        </label>
        <label className={styles.fieldLabel}>
          Height
          <input
            className={styles.input}
            type="number"
            min="1"
            value={plan.map.height}
            aria-invalid={heightIssue ? true : undefined}
            aria-describedby={heightIssue ? 'map-height-error' : undefined}
            onChange={(event) => updateMap({ height: Number(event.target.value) })}
          />
          {fieldIssue('map-height-error', ['map', 'height'])}
        </label>
      </div>
      <label className={styles.fieldLabel}>
        Tile size
        <select
          className={styles.select}
          value={plan.map.tileSize}
          onChange={(event) => updateMap({ tileSize: Number(event.target.value) as MapPlanV2['map']['tileSize'] })}
        >
          {[16, 32, 48, 64].map((size) => <option key={size} value={size}>{size}px</option>)}
        </select>
      </label>
      <label className={styles.fieldLabel}>
        Visual direction
        <textarea
          className={styles.textarea}
          value={plan.visualBrief}
          aria-invalid={visualBriefIssue ? true : undefined}
          aria-describedby={visualBriefIssue ? 'map-visual-brief-error' : undefined}
          onChange={(event) => updatePlan({ ...plan, visualBrief: event.target.value })}
        />
        {fieldIssue('map-visual-brief-error', ['visualBrief'])}
      </label>

      {region ? (
        <div className={styles.resourceInspector}>
          <h3>Terrain region</h3>
          <label className={styles.fieldLabel}>
            Terrain
            <select
              className={styles.select}
              value={region.terrainKey}
              aria-invalid={issueAt(['background', 'regions', regionIndex, 'terrainKey']) ? true : undefined}
              aria-describedby={issueAt(['background', 'regions', regionIndex, 'terrainKey']) ? 'region-terrain-error' : undefined}
              onChange={(event) => onCommand({
                type: 'region/update',
                region: { ...region, terrainKey: event.target.value },
              })}
            >
              {plan.terrains.map((terrain) => (
                <option key={terrain.assetKey} value={terrain.assetKey}>{terrain.name}</option>
              ))}
            </select>
            {fieldIssue('region-terrain-error', ['background', 'regions', regionIndex, 'terrainKey'])}
          </label>
        </div>
      ) : null}

      {path ? (
        <div className={styles.resourceInspector}>
          <h3>{path.kind === 'river' ? 'River' : 'Road'}</h3>
          <label className={styles.fieldLabel}>
            Name
            <input
              className={styles.input}
              value={path.name}
              onChange={(event) => onCommand({ type: 'path/update', path: { ...path, name: event.target.value } })}
            />
          </label>
          <label className={styles.fieldLabel}>
            Prompt
            <textarea
              className={styles.textarea}
              value={path.prompt}
              onChange={(event) => onCommand({ type: 'path/update', path: { ...path, prompt: event.target.value } })}
            />
          </label>
          <div className={styles.twoColumnFields}>
            <label className={styles.fieldLabel}>
              Width
              <input
                className={styles.input}
                type="number"
                min="1"
                value={path.width}
                onChange={(event) => onCommand({
                  type: 'path/update',
                  path: { ...path, width: Number(event.target.value) },
                })}
              />
            </label>
            <label className={styles.fieldLabel}>
              Order
              <input
                className={styles.input}
                type="number"
                value={path.zIndex}
                onChange={(event) => onCommand({
                  type: 'path/update',
                  path: { ...path, zIndex: Number(event.target.value) },
                })}
              />
            </label>
          </div>
        </div>
      ) : null}

      {placement ? (
        <div className={styles.resourceInspector}>
          <h3>Planned obstacle</h3>
          <div className={styles.twoColumnFields}>
            <label className={styles.fieldLabel}>
              X
              <input
                className={styles.input}
                type="number"
                value={placement.position.x}
                onChange={(event) => onCommand({
                  type: 'placement/move',
                  id: placement.id,
                  position: { ...placement.position, x: Number(event.target.value) },
                })}
              />
            </label>
            <label className={styles.fieldLabel}>
              Y
              <input
                className={styles.input}
                type="number"
                value={placement.position.y}
                onChange={(event) => onCommand({
                  type: 'placement/move',
                  id: placement.id,
                  position: { ...placement.position, y: Number(event.target.value) },
                })}
              />
            </label>
          </div>
        </div>
      ) : null}

      {selectedIssues.length > 0 ? (
        <ul className={styles.issueList} aria-label="Plan validation issues">
          {selectedIssues.slice(0, 6).map((issue) => (
            <li key={`${issue.code}-${issue.path.join('.')}`}>{issue.message}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
