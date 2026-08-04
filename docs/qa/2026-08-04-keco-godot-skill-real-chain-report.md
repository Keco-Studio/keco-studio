# Keco Godot Skill Post-Merge Real-Chain Report

Date: 2026-08-04
Branch under test: `skillsExtand`
Pull request: https://github.com/Keco-Studio/keco-studio/pull/288
Merge commit: `7041e18799409a1e4c9742f221974ba8de1666ee`

## Installed Artifact

- Marketplace: `keco-studio` (local repository marketplace)
- Installed version: `0.2.0+codex.20260804104649`
- Source manifest was restored to base version `0.2.0` after installation.
- Installed `SKILL.md` SHA-256: `59edf6ae0c0daef0beae40c54f6df408b93d62466816fb03f60b716fc9cc6430`
- Installed exporter SHA-256: `0f2d9ff5e6925880246af6778a755eb3040427a36f0e8354a817d1587d3ee48f`
- Installed validator SHA-256: `672953ad31eed8c916836eb406d76173bf09c8dfcfe8e0a4dccb0f8679677cfc`

The source and installed plugin files matched byte-for-byte before restoring the source manifest.

## Static Post-Merge Smoke

The installed snapshot scripts were exercised against `tests/fixtures/plugins/keco-godot-snapshot-input.json`.

```text
export_keco_snapshot.py: exit 0
aggregateSha256: 300dc52127bee95be732bb6ef84f6215457460e6e220e1c6f36fc6c281fd5b63
validate_snapshot.py: exit 0
ok: true, schemaVersion: 1, tableCount: 2
```

Post-merge routing and contract checks passed locally. The final local verification also passed the Skill validator, plugin validator, focused plugin/snapshot tests (13/13), full unit tests (2468 passed, 111 skipped), 134 MCP tests, MCP typecheck, TypeScript typechecks, lint (0 errors, 425 existing warnings), and production build.

## Keco Identity And Reads

- Connection probe: operational.
- Project: `another-spring`
- Keco project ID: `7eeea945-2ce8-4142-9af7-7dfc55bb359b`
- Latest feedback document: `v0803 feedback`, document ID `2cbe6993-607a-4670-b1a4-397f20d2bd2c`, epoch `0`, revision `151`.
- GDD document: `GDD v1.0 (organized)`, document ID `313a2dcb-98f8-4073-a990-69a6a34fae49`, epoch `0`, revision `2`.
- Current Keco structure read: 8 data tables and 12 documents; no Keco writes were attempted.

## Godot Gate

The Godot MCP connection gate failed before any game or Keco mutation:

```text
Cannot reach Godot at ws://10.17.0.1:6550
Suggestion: Ensure Godot is running with the MCP addon enabled.
Running in WSL: 127.0.0.1 does not cross to the Windows host.
In the Godot MCP panel set Bind mode: WSL (not Localhost), or set GODOT_HOST.
```

No Godot editor process or Godot executable was discoverable from the WSL/Windows environment during this run. Therefore the runtime EvalSpecs were recorded as `blocked`, no gameplay files were changed, no snapshot was loaded into the game, and no screenshots or runtime-state evidence were claimed. Mouse/absolute-input coverage remains `manual_required`.

## Game Baseline

- Project path: `C:\Users\lenovo\Desktop\another-spring` (`/mnt/c/Users/lenovo/Desktop/another-spring`)
- Branch: `extend`
- Git commit: `86fc5ceb3862ee9d227104697c6e9f871d971f32`
- Worktree: clean at read time.
- `project.godot` declares Godot feature `4.7`, main scene `res://scenes/main/village.tscn`, and autoload `GameState`.

## Residual Risk

The live sleep/day and data-source evaluations still need a running Godot 4.7 editor with the addon bound for WSL. The next run must repeat the identity gate, then collect structured runtime evidence and preserve the bounded repair limit from the installed Skill.
