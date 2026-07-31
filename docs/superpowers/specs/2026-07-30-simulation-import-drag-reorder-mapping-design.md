# Simulation Import Drag-Reorder Field Mapping Design

## Goal

Replace the Import screen wire-connect mapping UX with a row-aligned layout:
after LLM mapping, Studio source cards sit beside Simulation fields in the same
order; users fix mistakes by dragging cards up or down (including a bottom
unmapped pool).

## Scope

- `ImportScreen` mapping bridge UI only
- Client-side ordering and drag-to-remap derived from existing
  `FieldMapping` (`canonicalFieldId → studioColumnId`)
- Update unit/static tests that assert wire/port behavior

Out of scope:

- Changing the field-mapping LLM API or server validation
- Adding `cls` (or other fields) back to `SIM_FIELDS.characters`
- Import persistence / snapshot pipeline changes beyond consuming the same
  `FieldMapping` shape
- Introducing a DnD library dependency

## Confirmed Product Rules

1. **No wires.** Remove bezier paths, source/target ports, and drag-to-wire.
2. **Horizontal 1:1 alignment.** Left slot `i` corresponds to right
   `SIM_FIELDS[role][i]`.
3. **After LLM apply:** place each mapped Studio column into the slot for its
   canonical target; leave empty slots where a field is unmapped; put remaining
   Studio columns in a bottom **Unmapped** pool (still draggable).
4. **Drag remaps by position.**
   - Swap two mapped slots → swap their canonical targets.
   - Drag an unmapped column into a slot → that field maps to that column; the
     previous occupant (if any) moves to Unmapped.
   - Drag a mapped card into Unmapped → clear that field's mapping.
5. **Status.** Green when the current slot mapping is type/constraint
   compatible; red when incompatible or a required field slot is empty.
6. **Right column** stays a fixed list of simulation fields with mapped source
   labels and `N/M mapped`.

## Interaction Model

### Display model

For the active role, derive a view from `mappings[role]` + schema columns:

```
slots: Array<{ fieldId: string; columnId: string | null }>  // length = SIM_FIELDS[role]
unmapped: string[]  // studio column ids not present in mappings values
```

Left UI renders `slots` then a separated Unmapped section for `unmapped`.

Card label for a filled slot: `{columnName} → {fieldId}`.
Empty slot: placeholder such as `Drop a source column`.

### Drag

Native pointer drag (no new package):

- Grab handle on each filled card and each unmapped card.
- Drop targets: every slot row and the Unmapped region.
- On drop, recompute `FieldMapping` from the resulting slot assignment and
  `setMappings`. Do not keep a separate persistent order list; order is always
  derived from `SIM_FIELDS` + mapping.

### Clearing

Optional: keep an explicit clear affordance on a filled slot (e.g. ×) that
moves the column to Unmapped. Wire-delete is removed with the wires.

## Visual Notes

- Match the existing simulation workbench tokens (borders, blue active state).
- Drag handle (list icon) on the left of cards.
- Status icon on the right of left cards (check vs warning).
- Middle column becomes a narrow spacer (no ports), not a wire canvas.
- Sync scroll between left and right lists can remain for the slot region;
  Unmapped scrolls with the left list below the slot block.

## Compatibility / Status Rules

Reuse existing type compatibility ideas from AI mapping validation where
practical (valueTypes / allowedValues on `SimulationFieldDefinition` vs Studio
column `valueType`). If a compact client helper does not already exist for the
Import screen, add a small pure function next to simulation mapping helpers
rather than calling the server on every drag.

Required empty slots always show error state on the left slot and/or right row
(consistent with today's missing-required styling on the right).

## Copy

Update helper text from port/wire language to drag-reorder language, e.g.
"AI maps fields into rows. Drag cards to swap or move unmapped columns into
empty slots."

## Testing

- Unit: pure helpers for building `slots`/`unmapped` from a mapping, and for
  applying a drag result back to `FieldMapping`.
- Unit/static: `ImportScreen` no longer references wire/port/bezier entry
  points; asserts drag-handle / unmapped section presence as needed.
- Update e2e copy or selectors only if they depend on ports/wires (prefer
  role/testid on cards if added).

## Acceptance

- Selecting a library still runs AI mapping, then shows left cards aligned to
  right fields with extras at the bottom.
- Dragging swaps or assigns mappings without drawing wires.
- Import still proceeds from the same `FieldMapping` object.
- Greetings/assistant chat behavior is unrelated and unchanged.
