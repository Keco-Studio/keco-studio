# Keco Godot Evaluation-Driven Development Skill Design

**Date:** 2026-08-04
**Status:** Approved for implementation
**Primary user:** A game developer using Keco as the design source and Godot as the runtime
**Initial validation project:** `C:\Users\lenovo\Desktop\another-spring`

## 1. Outcome

Add one orchestration Skill to the existing `keco` Codex plugin. The Skill turns an explicit Keco-driven Godot development request into a bounded, evaluation-driven gameplay slice:

```text
Keco GDD, feedback, and tables
  -> resolve source conflicts
  -> select one minimal gameplay slice
  -> define evaluations before implementation
  -> design and maintain Keco tables
  -> export a versioned read-only Godot snapshot
  -> implement the slice
  -> drive and observe Godot through MCP
  -> score evaluations and repair bounded failures
  -> retain a report in Keco and the Godot repository
```

The Skill exists to make Godot MCP usage deliberate and reproducible instead of relying on ad hoc tool selection.

## 2. Existing Baseline

The Keco plugin already ships `keco-build-tables-from-document`. That Skill creates new Keco tables from an existing Keco document through a read-plan-confirm-execute-verify workflow. It remains narrowly scoped and is not invoked by the new orchestration Skill.

The `another-spring` Keco project contains a consolidated GDD, newer feedback, and runtime-oriented tables such as activities, seasons, character status, resources, characters, collectibles, and media. The Godot project is a Godot 4.7 portrait project with a village scene, global game state, collection minigame, difficulty logic, generated assets, and an initial survival loop.

The current artifacts already demonstrate source drift:

- newer feedback removes morning/afternoon/night slots and advances the day only through sleep;
- the current Godot state still advances three time slots through ordinary actions;
- Keco tables contain activity, season, and status values that are duplicated as hard-coded GDScript constants;
- the Godot implementation is newer than the GDD's stated implementation baseline.

The Skill must detect and resolve this class of conflict before editing data or code.

## 3. Architecture Decision

Use one orchestration Skill with internal references and deterministic scripts.

| Approach | Advantages | Disadvantages | Decision |
|---|---|---|---|
| One large `SKILL.md` | Smallest initial file count | Context-heavy and difficult to maintain | Reject |
| Multiple independently triggered phase Skills | Small phase-specific prompts | Overlapping triggers and conflicting ownership | Reject |
| One Skill with internal contracts and scripts | One owner, fixed state machine, deterministic helpers | Requires explicit contracts | Adopt |

The plugin structure is:

```text
plugins/keco/skills/keco-develop-godot-slice/
├── SKILL.md
├── agents/openai.yaml
├── references/
│   ├── source-priority.md
│   ├── data-plan.md
│   ├── slice-plan.md
│   ├── eval-spec.md
│   ├── godot-mcp-policy.md
│   └── recovery-policy.md
└── scripts/
    ├── export_keco_snapshot.py
    └── validate_snapshot.py
```

The Keco plugin does not bundle or duplicate the Godot MCP configuration. The Skill requires an externally configured `godot` MCP server and stops before writes when it cannot validate that connection and project identity.

## 4. Trigger And Ownership Contract

The Skill triggers for explicit requests to implement or continue a Godot gameplay slice using Keco project documents, feedback, or tables as the design source. Examples include:

- "Develop the next Another Spring slice from the Keco GDD."
- "Implement the latest Keco feedback in Godot and run the evaluations."
- "Synchronize the Keco game data into Godot and fix the season system."
- an explicit `$keco-develop-godot-slice` invocation.

It does not trigger for:

- reading or summarizing a GDD without implementation intent;
- creating Keco tables without Godot implementation;
- a Godot bug unrelated to Keco design sources;
- asset generation;
- running existing tests without development;
- Keco Studio repository development.

Routing is exclusive:

```text
Keco document -> new tables only
  -> keco-build-tables-from-document

Keco design -> data design -> Godot implementation -> evaluation
  -> keco-develop-godot-slice

Godot-only bug with no Keco design change
  -> general debugging workflow
```

When the new Skill owns a request, it performs required Keco table work through its own DataPlan and never invokes the document-to-tables Skill.

An explicit invocation authorizes the complete bounded workflow. The Skill does not ask for a second confirmation after presenting plans. It may not expand beyond the selected slice.

## 5. Source Of Truth And Precedence

Keco documents and tables are the design source of truth. Godot consumes exported snapshots and owns only runtime state such as saves, transient scene state, and evaluation observations.

Resolve conflicts in this order:

1. the current user instruction;
2. the newest explicit Keco feedback or change document;
3. current GDD goals and acceptance criteria;
4. Keco tables;
5. the current Godot implementation.

Record every material conflict and the chosen source in the run report. Update lower-priority artifacts to match higher-priority decisions. Never overwrite Keco design data from an edited local snapshot.

## 6. State Machine And Artifacts

Every run uses this fixed state machine:

```text
CONNECT
  -> DISCOVER
  -> RESOLVE_SOURCES
  -> SELECT_SLICE
  -> DEFINE_EVALS
  -> DESIGN_DATA
  -> EXPORT_SNAPSHOT
  -> IMPLEMENT
  -> VERIFY_STATIC
  -> EVALUATE_RUNTIME
  -> REPAIR (up to three iterations)
  -> REPORT
```

### 6.1 RunContext

Bind all actions to one run identity:

```yaml
run_id: another-spring-gather-loop-20260804
keco_project_id: 7eeea945-2ce8-4142-9af7-7dfc55bb359b
godot_project_path: C:\Users\lenovo\Desktop\another-spring
godot_git_commit: 86fc5ce
slice_id: gather-settlement-loop
source_revisions: {}
allowed_files: []
iteration: 0
```

### 6.2 SourceSnapshot

Record selected Keco document revisions, table IDs and schemas, relevant table rows, Godot commit and dirty paths, current scene, project settings, Godot version, addon status, and MCP capabilities.

### 6.3 SlicePlan

Each run selects one independently evaluable slice. A generic continuation request selects the highest-priority smallest unmet GDD acceptance target.

The plan records the objective, source evidence, acceptance targets, explicit exclusions, data changes, allowed Godot files, dependencies, and risks. Implementation and repair may touch only allowed files unless a newly discovered required dependency causes the run to re-plan from `SELECT_SLICE`.

### 6.4 DataPlan

The Agent may design new domain tables, fields, references, stable keys, initial rows, compatible additive schema changes, and updates to existing configuration rows. It may not automatically delete tables, fields, or rows, or perform destructive field-type conversions.

All table and row identities use stable keys. Every planned value keeps source evidence. Unsupported or destructive requirements block the run instead of being silently approximated.

### 6.5 EvalSpec

Define evaluations before implementation. Each evaluation contains:

- a stable ID and source requirement;
- deterministic preconditions;
- player or system actions;
- expected state and tolerances;
- required evidence;
- an explicit pass rule;
- whether manual evidence remains required.

Evaluation types are:

- `state`: exact configuration, inventory, state, date, and persistence assertions;
- `flow`: scene transitions, dialogue, death, reincarnation, and interaction paths;
- `regression`: previously working slice behavior;
- `visual`: visibility, layout, clipping, and overlap checks;
- `experience`: pacing and readability goals that must not be presented as objective automation.

### 6.6 SnapshotManifest

Export Keco tables to deterministic, versioned JSON inside the Godot project. Generated files are read-only inputs and are never manually maintained. The manifest records the Keco project ID, source table and document revisions, schema version, export timestamp, individual file hashes, and aggregate content hash.

The Godot runtime must expose or otherwise make observable the loaded schema version and aggregate hash so evaluations can reject stale data.

### 6.7 EvalReport

Record each evaluation's status, actual values, evidence summary, repair iteration, Godot commit, snapshot hash, conflicts, skipped checks, manual requirements, and residual risks. A successful write or clean parse is not evidence of runtime success.

## 7. Keco Development Records

In addition to Agent-designed domain tables, maintain a stable development record model:

- `Development Slices`: slice ID, objective, state, source revisions, Godot commit, and snapshot hash;
- `Evaluation Cases`: eval ID, slice ID, type, preconditions, action, expected result, evidence contract, and pass rule;
- `Evaluation Runs`: run ID, eval ID, result, actual observation, evidence summary, commit, snapshot hash, and repair iteration.

Create these tables when absent and update them by stable IDs afterward. Keep evaluation state out of runtime game configuration tables.

## 8. Godot MCP Policy

Use Godot MCP as the authoritative editor and runtime observation surface:

```text
project and addon identity check
  -> read scenes, nodes, resources, settings, and logs
  -> run with frozen=true
  -> establish deterministic preconditions with godot_exec
  -> advance bounded time with step or step_until
  -> inject supported player inputs
  -> inspect structured runtime state
  -> capture only necessary screenshots
  -> stop and run again after gameplay script edits
```

Rules:

- Prefer runtime-state digests over screenshots for value assertions.
- Read back every scene or node edit immediately.
- Use stop/run for ordinary gameplay script changes. Restart the editor only for addon code, stale `project.godot`, or cached shaders.
- Use the smallest bounded input sequence and time step that proves an expectation.
- Use screenshots only for appearance, clipping, visibility, and visual evidence.
- Do not claim true mouse black-box coverage when absolute mouse input is unavailable. Use stable UI actions or controlled in-game input events where valid, otherwise mark the evaluation `manual_required`.
- Verify that the running game loaded the current snapshot hash.
- Clear persistent `godot_exec` holder state after each evaluation.

## 9. Automatic Repair Boundary

After the first evaluation pass, repair only failed evaluations and their directly affected regressions. Run at most three repair iterations. Each iteration must:

1. retain the original EvalSpec;
2. identify the failed expectation and evidence;
3. change only allowed files or re-enter planning;
4. rerun the failed evaluation;
5. rerun affected regression evaluations.

After three failed iterations, stop and report the evidence without claiming completion.

## 10. Failure And Recovery

| Failure | Required behavior |
|---|---|
| Keco MCP unavailable | Stop before writes |
| Godot MCP unavailable or wrong project | Stop before writes |
| Source revision changes during a run | Discard the old RunContext and re-plan |
| Unrelated dirty Godot files | Preserve and avoid them |
| Dirty file overlaps an allowed file | Work from current contents; never revert user changes |
| Keco partial write | Stop, retain completed IDs, re-read before retry, never roll back destructively |
| Snapshot export or validation failure | Do not enter implementation |
| Godot parse, resource, or scene error | Repair within the slice and iteration budget |
| Evaluation failure after three repairs | Persist a failed report with evidence |
| Unverifiable interaction | Mark `manual_required`; do not invent a pass |

At run completion, the Godot worktree may contain only original user changes and planned slice changes.

## 11. Initial Another Spring Evaluation Target

The first real-chain validation targets the conflict between the latest feedback and current implementation:

- remove ordinary morning/afternoon/night progression;
- make sleep restore energy to full and advance exactly one day;
- load activity, season, and status configuration from the generated Keco snapshot instead of duplicated constants;
- retain the existing collection reward and survival-loop behavior where it does not conflict with newer feedback.

The Skill must first demonstrate that the current implementation fails the new EvalSpec, then implement and demonstrate the corrected behavior.

## 12. Testing Strategy

### 12.1 Static validation

- Validate Skill frontmatter, folder name, references, scripts, `agents/openai.yaml`, and plugin manifest.
- Assert that the Keco plugin does not declare a duplicate Godot MCP server.
- Validate all referenced paths and required executable permissions.

### 12.2 Trigger matrix

Test positive, negative, and overlap prompts. A Keco-to-Godot implementation request must select only the new Skill. A document-only table request must select only the existing Skill.

### 12.3 Script tests

- identical normalized Keco inputs produce byte-identical domain JSON;
- generated ordering is stable;
- hashes and manifest entries match file contents;
- invalid schemas, duplicate stable keys, missing references, and edited generated files fail validation;
- snapshots never contain run observations or local save state.

### 12.4 Contract fixtures

Use the observed Another Spring conflicts as fixtures: time-slot removal, sleep day advancement, duplicated hard-coded configuration, and stale GDD implementation status.

### 12.5 Godot real-chain test

With the editor open and the addon bound for WSL:

1. verify project and addon identity;
2. run the baseline evaluation and retain the expected failure;
3. execute the selected slice;
4. reload gameplay scripts through stop/run;
5. freeze, establish preconditions, inject actions, and step time;
6. collect runtime state, logs, and minimal visual evidence;
7. verify the selected evaluations, regressions, and snapshot hash;
8. persist the final report without fabricating unsupported mouse evidence.

### 12.6 Forward tests

Exercise three prompts against the real project:

- a specifically named gameplay feature;
- implementation of the latest Keco feedback;
- automatic selection of the next slice.

Review scope selection, data design, MCP ordering, evaluation quality, repair bounds, and trigger isolation.

## 13. Release And Validation Sequence

Implement on the `skillsExtand` branch. Run local static, unit, Skill, plugin, and script validation. Push the branch, merge through the repository's normal pull-request path, update the installed plugin cache through the supported cachebuster flow, start a fresh Codex process if required, and then run the post-merge real-chain test against `C:\Users\lenovo\Desktop\another-spring`.
