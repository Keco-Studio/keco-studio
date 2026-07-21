# Document editor toolbar sticky in viewport

Date: 2026-07-20  
Status: Approved (approach 1)

## Goal

While editing a long document, the MDX formatting toolbar stays pinned to the **top of the dashboard content scroll area** (directly under the app TopBar). It must not scroll away with the document body. Document title / status header continue to scroll normally.

## Context

- Scroll container: `DashboardLayout` `.content` (`overflow-y: auto`). TopBar sits outside that scroller.
- MDXEditor’s default toolbar already uses `position: sticky; top: 0`, plus a stable class `mdxeditor-toolbar`.
- Our `.editor` rule sets `overflow: hidden`, which makes sticky resolve against a non-scrolling ancestor, so the toolbar scrolls away with the card.

## Behavior

1. At rest (document scrolled to top): toolbar sits at the top of the bordered editor card (current look).
2. While scrolling the content area: toolbar sticks at `top: 0` of `.content` (under TopBar).
3. Opaque background so editor text does not show through.
4. `z-index` above document body / collab cursors, below modals and popovers.
5. Toolbar dropdowns and reference picker remain usable while stuck.

## Approach

**CSS-only sticky enablement** (no JS fixed positioning, no toolbar extraction).

## Implementation notes

File: `src/components/documents/MdxDocumentEditor.module.css` (+ small wiring in `MdxDocumentEditor.tsx` if needed)

1. Change `.editor` from `overflow: hidden` to `overflow: visible` so sticky can use the dashboard content scroller.
2. Pass `toolbarClassName: styles.stickyToolbar` into `toolbarPlugin({...})` (MDXEditor supports this) — prefer this over brittle `[class*="toolbarRoot"]` selectors.
3. `.stickyToolbar` reinforces:
   - `position: sticky`
   - `top: 0`
   - solid background (`var(--ant-color-bg-container)` / matching editor tokens)
   - `z-index` high enough vs body (e.g. above collab cursors at 5, below modal layer)
   - optional bottom border / shadow while stuck is nice-to-have; not required for v1
4. Preserve card rounding without `overflow: hidden`: keep `border-radius` on `.editor`; give toolbar matching top radius so the stuck bar still looks attached to the card chrome when at rest.

## Out of scope

- Sticking the document title / collaboration status row
- Changing TopBar layout
- Extracting a custom toolbar outside MDXEditor
- JS scroll listeners / `position: fixed` fallbacks

## Acceptance

- Long doc: scroll down → toolbar remains visible under TopBar; title scrolls away.
- Scroll back to top → toolbar returns to editor card top.
- Formatting controls and Insert reference still work while stuck.
- No regression to collab cursors or reference highlight overlays.

## Spec self-review

- No placeholders / TBD left for required behavior.
- Matches chosen approach 1; no contradiction with “under TopBar” (TopBar is outside `.content`).
- Scope limited to sticky CSS + toolbarClassName wiring.
