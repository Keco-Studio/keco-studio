# Explicit Art Style Selection Design

## Problem

The Game Design System creation flow currently initializes the Art Style stage
with Pixel Art already selected. A user can therefore generate a GDD without
making an Art Style decision, while the persisted request still looks valid.
The UI cannot distinguish an explicit choice from an untouched default.

The creation flow must require an explicit preset choice. Art Style
customization remains optional.

## Goals

- Start a new Game Design System with no selected Art Style preset.
- Require the user to select one catalog preset before leaving the Art Style
  stage or starting generation.
- Explain why progress is blocked and how to recover.
- Keep visual reference games, custom art direction, and avoid guidance
  optional.
- Preserve the existing paired-field validation for any visual reference row
  the user adds.
- Keep the server contract strict: a generation request without a valid
  `artStyle.presetId` and `artStyle.presetVersion` is rejected before job
  creation.

## Non-Goals

- Requiring a visual reference game.
- Requiring custom art direction or avoid guidance.
- Changing immutable historical Game Design System versions.
- Changing the Game Design System version editor.
- Changing saved Art Style snapshots or preset definitions.
- Adding a new Art Style preset.

## Creation Experience

### Initial State

The Art Style catalog has no active option when the creation flow opens. Pixel
Art remains the first and recommended catalog option, but it is not selected on
the user's behalf.

The preview area renders a stable empty state instead of a preset preview:

> Select an Art Style to preview its visual direction.

The empty state must keep the workbench dimensions stable so selecting a preset
does not cause a disruptive layout shift.

### Selecting a Preset

Clicking or keyboard-activating a catalog option sets the selected preset key.
The selected option receives the existing active and accessibility state, and
the full preset preview replaces the empty state. Changing the selection later
updates the preview and submitted preset identity.

### Optional Customization

The following inputs remain optional and do not determine whether an Art Style
has been selected:

- Custom art direction.
- Visual reference games.
- Avoid guidance.

If a visual reference row is added, its game name and `What to borrow` value
must both be present. An entirely blank row is ignored by normalization, as it
is today.

### Progress and Submission Gates

`Continue to sources` validates that a preset was explicitly selected. When it
is missing, the page stays on Art Style and shows:

> Select an Art Style before continuing.

The final `Generate system` action repeats the same invariant in case the user
navigated directly with the stage tabs. It returns to Art Style and shows:

> Select an Art Style before generating.

Both errors focus the error summary. Selecting a preset clears the selection
error. Incomplete visual reference errors continue to focus the missing input
and preserve all entered values.

### Review State

The normal review summary renders only after a preset has been selected through
the linear flow. If direct stage-tab navigation reaches Review without a
selection, the Art Style summary renders a neutral `Not selected` state rather
than inventing a fallback preset. Final submission remains blocked.

## State and Data Flow

`GameDesignSystemCreatePage` stores the selected catalog key as an empty value
until user interaction. Preset resolution returns no preset for that empty
value; it must not fall back to `DEFAULT_GAME_ART_STYLE_KEY`.

Once selected, the existing `gameArtStyleInputSchema` normalizes the chosen
preset identity and optional customization. `generationInput` is called only
with a successful normalized Art Style result.

The API continues to require `artStyle` through
`gameDesignGenerationRequestSchema`. A request that omits the selector or sends
an invalid preset identity receives HTTP 400 before a durable generation job is
created. A valid preset with empty customization is accepted because selecting
the preset itself satisfies the requirement.

## Component Boundaries

- `GameDesignSystemCreatePage` owns selection-required validation, empty-state
  rendering, focus management, review fallback, and request gating.
- `GameArtStyleCatalog` accepts a nullable selected key and exposes no option as
  active until one is selected. Its keyboard behavior remains unchanged.
- `GameArtStylePreview` continues to render real preset details only; the create
  page owns the no-selection placeholder.
- `gameDesignGenerationRequestSchema` remains the server authority for a valid
  Art Style selector. Regression coverage proves missing Art Style input is
  rejected and valid preset-only input is accepted.

## Accessibility

- No catalog item exposes `aria-selected=true` before user selection.
- The no-selection error uses `role="alert"`, remains focusable, and is linked
  to the Art Style workbench where practical.
- Keyboard selection through the catalog establishes the same state as pointer
  selection.
- The placeholder and selected preview use stable headings and do not hide the
  catalog from assistive technology.

## Test Coverage

Component tests cover:

- The initial catalog has no selected option and shows the placeholder.
- Continuing without a selection stays on Art Style and explains the remedy.
- Direct navigation to Review followed by generation returns to Art Style and
  does not call the generation client.
- Selecting a preset with no customization is accepted and submits that exact
  preset identity.
- Custom direction or avoid guidance without a preset does not unlock progress.
- A half-complete visual reference still reports the existing paired-field
  error after preset selection.
- Pointer and keyboard preset selection produce the active catalog state.

Schema tests cover:

- Missing Art Style is rejected.
- Invalid preset selectors are rejected during compilation before job creation.
- A valid preset with empty customization remains accepted.

## Rollout and Production Verification

After merge and successful deployment:

1. Open the production Game Design System creation flow.
2. Enter the minimum valid Foundation data and continue to Art Style.
3. Confirm no preset is selected and the placeholder is visible.
4. Attempt to continue without selecting a preset and confirm the local error.
5. Select a preset, leave all customization empty, and confirm progression to
   Sources and Review.
6. Submit and confirm the generation request contains the explicitly selected
   preset identity.
7. Add a visual reference with only a game name and confirm submission is
   blocked with the paired-field explanation.

Production verification must not create unnecessary duplicate systems. Any
durable test system created for the successful path must use a timestamped,
clearly test-only title and be reported after verification.
