# Draggable Agent Launcher (P0) Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the closed Agent launcher draggable anywhere in the viewport, persist position, keep click-to-open.

**Architecture:** Small hook `useDraggableLauncherPosition` owns localStorage + pointer drag vs click threshold; `ChatPanel` applies position styles to the launcher button.

**Tech Stack:** React, CSS modules, Jest for pure helpers.

## Global Constraints

- Only closed launcher is free-positioned (open panel unchanged).
- Persist key: `keco.agentLauncherPosition`.
- Drag threshold ~5px; clamp fully on-screen.

---

### Task 1: Position helpers + unit tests

**Files:**
- Create: `src/components/agent/draggableLauncherPosition.ts`
- Create: `tests/unit/agent/draggable-launcher-position.test.ts`

- [ ] Export `LAUNCHER_SIZE`, storage key, `clampLauncherPosition`, `readStoredLauncherPosition`, `writeStoredLauncherPosition`
- [ ] Tests: clamp corners/edges; invalid storage → null; round-trip write/read (mock localStorage)

### Task 2: Hook + ChatPanel wiring

**Files:**
- Create: `src/components/agent/useDraggableLauncherPosition.ts`
- Modify: `src/components/agent/ChatPanel.tsx`
- Modify: `src/components/agent/ChatPanel.module.css`

- [ ] Hook returns `{ style, onPointerDown, isDragging }`
- [ ] Launcher uses left/top when position set; default CSS right/bottom when null
- [ ] `.launcherDragging` disables transition; `touch-action: none`
- [ ] Manual: drag, refresh, click-without-drag opens panel
