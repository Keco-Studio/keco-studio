# Project Template Picker UI Design

**Date:** 2026-11-12

## Goal

Redesign Create Project so a project remains a lightweight workspace container while users can choose a representative game-project starting point. Project creation collects only a project name and a short project description. Game genres and design philosophies no longer appear in project creation or project settings; those concepts remain owned by the Game Design System workflow.

This first delivery is UI-only. It establishes the template catalog, selection interaction, responsive layout, and a stable template key for future work. It does not generate documents, tables, rules, art direction, or other template content.

## Product Boundary

The project layer owns:

- project name;
- project description;
- collaborators, access, billing, and other workspace administration; and
- the selected starter presentation during the open creation dialog.

The Game Design System layer continues to own:

- game genres;
- design philosophies;
- intended player experience and suitability;
- art style and visual references;
- gameplay reference games and source material; and
- generated, editable, and versioned game rules.

Existing `projects.genres` and `projects.design_philosophies` columns remain for compatibility in this phase, but the Create Project and project Profile interfaces stop displaying or editing them. New projects continue to store their current empty defaults. Saving a legacy project's name or description must preserve any existing genre and philosophy values unchanged.

## Template Catalog

The Create Project dialog offers these fixed starters:

| Key | Display name | Short positioning |
| --- | --- | --- |
| `blank` | Blank project | An empty workspace for a custom structure. |
| `tactical-deckbuilder` | Tactical deckbuilder | Card synergies, encounter pacing, and progression. |
| `narrative-adventure` | Narrative adventure | Characters, branching choices, and consequences. |
| `survival-builder` | Survival builder | Gathering, crafting, survival pressure, and base growth. |
| `management-simulation` | Management simulation | Resources, production chains, and long-term tradeoffs. |
| `action-roguelike` | Action roguelike | Responsive combat, run variation, and meta progression. |
| `cooperative-puzzle` | Cooperative puzzle | Shared information, complementary roles, and communication. |

The catalog is a typed frontend constant. A future implementation may use the stable key to instantiate project resources, but this phase does not send or persist the key.

## Create Project Dialog

The existing modal remains the entry point and retains the site's quiet operational visual language: white surface, restrained gray borders, compact typography, and the existing blue action color.

The body has two sections:

1. **Start from a template**
   - A full-width Blank project option appears first.
   - Six representative templates appear in a responsive two-column grid.
   - Each option is a button with an existing Ant Design icon, display name, and one-line positioning.
   - The selected option uses a blue border, pale-blue background, and check indicator.
   - Blank project is selected whenever the dialog opens or resets after successful creation.

2. **Project details**
   - Project name remains required.
   - Description remains optional and is described as a short explanation for collaborators.
   - Game genres and Design philosophies are removed.

The footer retains inline error handling and the existing Create action. Template selection must not change the project name or description automatically and must not claim that template resources were created.

## Responsive Behavior

- Desktop and wide tablet: template cards use two columns.
- Narrow tablet and mobile: cards collapse to one column.
- The modal remains bounded by the viewport and its body scrolls while the header and footer remain reachable.
- Text wraps inside template cards without changing icon or selection-control dimensions.

## Accessibility

- Template choices are native buttons inside a labeled group.
- The selected choice exposes `aria-pressed="true"`.
- Each card has a stable accessible name containing its template name.
- Keyboard users can tab through and select every template.
- Focus styling remains visible and does not rely on color alone.
- The project name label, description label, dialog title, close action, errors, and submit behavior retain their current accessible relationships.

## Component Boundaries

- `NewProjectModal` owns the selected template state and project submission lifecycle.
- A dedicated `ProjectTemplatePicker` renders the catalog and selection controls.
- A small typed catalog module owns template keys, labels, descriptions, and icon identifiers.
- `ProjectFoundationFields` is replaced or narrowed to project identity fields only. It must not remain named or modeled as a game-design foundation.
- `projectService` continues accepting compatibility fields internally, but Create Project submits only `name` and `description`.
- Project Profile in Settings uses the same identity fields and no longer exposes genres or design philosophies. Its save path carries existing compatibility values through unchanged so an identity edit cannot erase legacy metadata.

## Data Flow

1. Opening the dialog initializes `selectedTemplateKey` to `blank`, with empty name and description.
2. Choosing a card changes only `selectedTemplateKey` in local state.
3. Create validates the name and calls the existing project creation service with name and description.
4. Successful creation resets all local state and follows the existing navigation/cache flow.
5. Failed creation keeps the selected template, name, and description visible for correction or retry.

## Error Handling

- Existing required-name, invalid-name, duplicate-name, and service errors remain unchanged.
- Template selection cannot fail because the catalog is local and static.
- Unknown template keys fall back to `blank` if state restoration is added later.
- No UI text promises generated starter content during this phase.

## Testing

Component coverage will verify:

- Blank project is selected by default.
- Every representative template is rendered and selectable.
- Selection exposes the correct pressed state.
- Create submits only the project name and description.
- Project creation no longer renders Game genres or Design philosophies.
- Failed creation preserves template selection and identity fields.
- Successful creation resets selection to Blank project.
- Project Settings no longer renders genres and design philosophies or allows users to modify them.
- Project Settings identity saves preserve existing stored genre and philosophy values.

Static/responsive checks will verify the two-column desktop grid, one-column mobile layout, bounded modal height, and scrollable body.

## Out of Scope

- Persisting a template key on a project.
- Creating template database records or a template marketplace.
- Instantiating folders, documents, tables, rules, art direction, or assets.
- Auto-filling the project description from a template.
- Changing the Game Design System creation stages or generation model.
- Migrating or deleting existing project genre and philosophy data.
