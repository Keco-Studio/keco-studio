# Compact Asset Grid Scaling

## Goal

Extend the Windows Explorer-style asset scaling so the smallest setting is a
real `10%` compact mode. At the compact threshold, assets switch to one item
per row instead of shrinking image tiles into unusable banners. Existing
multi-column gallery behavior, selection, previews, detail panels, and upload
flows remain unchanged.

## Design

- Keep one shared ordered scale model for the library grid and `/admin/assets`.
- Preserve the existing `60%` through `150%` levels and add smaller levels
  below the current default: `40%`, `25%`, and `10%`.
- Keep the default at `100%` by exposing a shared default index rather than
  relying on a positional literal.
- Treat `10%` as the compact/list level. The grid renders one asset per row,
  with a small fixed preview and the asset name beside it. It does not stretch
  the source image to the full row width.
- `Ctrl/Cmd + wheel` and the existing decrease/increase controls traverse the
  same bounded scale list. At the `10%` bound, further decrease gestures have
  no effect.
- The library grid and admin gallery use the same scale labels and boundary
  behavior. Their existing layout-specific rendering remains separate.

## Verification

- Unit tests cover the new scale ordering, default index, lower bound, and
  compact-mode predicate.
- Admin and library component tests cover compact rendering and one-item rows.
- Playwright verifies wheel and button navigation reaches `10%`, page zoom is
  not triggered, and compact rows remain selectable/openable.
- Run focused tests, lint, typecheck, production build, and the repository
  character gate before opening a PR.
