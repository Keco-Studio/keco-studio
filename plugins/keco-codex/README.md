# Keco Codex plugin

The Codex packaging exposes one active Godot Slice entry,
`keco-develop-godot-slice-v2`, backed by five phase modules:

- `keco-godot-slice-preflight`
- `keco-godot-slice-assets`
- `keco-godot-slice-implementation`
- `keco-godot-slice-verification`
- `keco-godot-slice-delivery`

The canonical contract manifest and conformance corpus are in
`contracts/keco-slice-v2/`. Codex and Claude share the same semantic validators
and references. The retired V1 entry is intentionally not packaged.
