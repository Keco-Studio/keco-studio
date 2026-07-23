# Simulation Import Rules Design

**Date:** 2026-07-23
**Status:** Approved for direct implementation

## Goal

Make Studio table selection immediately create deterministic field connections,
then let users adjust them manually. Import blocks only data that cannot produce
a runnable snapshot; duplicate or non-contiguous curve levels become warnings.

## Field Contracts

- Characters require `id`, `name`, `el`, `hp`, `atk`, `def`, `spd`, and `mp`;
  `cls` is optional.
- Skills require `id`, `name`, `el`, `mp`, `power`, `cd`, and `kind`; `status`
  and `fx` are optional.
- Level curves require `level`, `exp`, and `sp`; `character_id` is optional.
- Skill curves require `skill_id`, `lv`, and `cost` for new imports.

Each field has explicit English/Chinese aliases and compatible Studio value
types. Selecting a table clears that role's old mapping and auto-maps the new
schema by exact alias first, then unambiguous normalized alias, while preventing
one Studio column from mapping twice. Manual changes remain available afterward.
Late schema responses from an earlier table selection are ignored.

## Curve Models

`LevelRule` gains optional `characterId`. Character-specific rules take
precedence over shared rules. `SkillCostRule` gains optional `skillId` so old
shared snapshots remain readable; new Studio imports require a skill ID and use
skill-specific rules first.

Levels may repeat across characters or skills, start above 1, and contain gaps.
Duplicate composite keys and gaps are warnings. The first source row wins for a
duplicate composite key. Missing exact rules disable the affected upgrade or
level progression unless a shared fallback exists.

## Errors And Warnings

Blocking errors cover missing required mappings/values, incompatible types,
invalid enums/ranges, duplicate character/skill IDs, unresolved curve entity
references, and rule tables with no usable rows. Warnings cover level gaps,
non-1 starting levels, duplicate composite curve rows, and incomplete per-entity
coverage.

Successful imports may carry warnings. The UI reserves `Import blocked` for
errors and shows `Imported with warnings` separately without preventing the user
from continuing.

## Compatibility

Existing snapshots without `characterId` or `skillId` remain valid shared-rule
snapshots. No persistence schema version bump is required.

## Verification

Unit tests cover alias/type matching, mapping replacement and stale response
isolation, warning-producing curve imports, unresolved references, specific-rule
precedence, shared fallback, storage validation, and affected progression flows.
