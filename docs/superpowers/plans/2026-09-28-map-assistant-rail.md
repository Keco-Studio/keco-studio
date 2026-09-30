# Map Assistant Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Create Map's pre-globalization left chat while moving the single global assistant launcher to the bottom of the product rail across all supported workspaces.

**Architecture:** `DashboardLayout` owns assistant visibility/open state and passes a controlled trigger to `LeftNav` and `AssistantHost`. `ChatPanel` becomes panel-only. `DirectMapWorkbench` restores its original `MapChatPanel` presentation while retaining the global assistant's map-refresh bridge and all current Map data services.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS Modules, Jest/Testing Library, Playwright.

## Global Constraints

- UI stage only. Tool parity follows after UI verification.
- Assistant routes: Projects, Studio project pages, Script, Create Map, Game Design Systems. Exclude Simulation, account, billing, MCP, admin, Keco 101.
- Keep existing server APIs, Map V3 persistence, generation, collision, and assistant-to-Map refresh bridge.
- Do not use TDD. Add or update tests after implementation, then run one unified review.

---

### Task 1: Restore Create Map conversation

**Files:**
- Create: `src/features/create-map/components/MapChatPanel.tsx` (restore its pre-PR #469 version)
- Modify: `src/features/create-map/DirectMapWorkbench.tsx`
- Modify: `src/features/create-map/CreateMapWorkbench.module.css`
- Test: `tests/unit/create-map/map-chat-panel.test.tsx`
- Test: `tests/unit/create-map/workbench-wiring.test.tsx`
- Test: `tests/e2e/specs/create-map-v3.spec.ts`

**Interfaces:** `MapChatPanel` consumes `MapChatMessage[]`, `MapGenerationHistoryEntry[]`, Map plan/image card props, and callbacks `onAsk(prompt)`, `onAttachFile`, `onAttachKecoDocument`, `onViewMapPlan`. `DirectMapWorkbench` continues to call `createMapService.createPlanV3` and to consume `createMapAgentRefreshKey`.

- [ ] **Step 1: Restore the Map chat component and its CSS from `73a6b1a3^1` using `apply_patch`.** Restore only its presentation and local input behavior; do not revert Map V3 service changes or the agent refresh bridge.
- [ ] **Step 2: Reconnect Map state and callbacks in `DirectMapWorkbench`.** Keep `createMapAgentRefreshKey`, `openSavedMap(target, true)`, `savedMapSwitchBlocked`, and the existing generation/collision hooks. Restore the original message sequence around plan creation, saved-map opening, and generated-image completion:

```tsx
const [description, setDescription] = useState('');
const [chatMessages, setChatMessages] = useState<MapChatMessage[]>([]);
const request = (prompt ?? description).trim();
<MapChatPanel
  mapTitle={plan.name}
  messages={chatMessages}
  onAsk={(prompt) => void createPlan(prompt)}
  generationHistory={generationHistory}
  mapPlan={draft.identity ? { title: plan.name, versionLabel: mapVersionLabel ?? '' } : null}
  mapImage={image ? { title: plan.name, versionLabel: mapVersionLabel ?? '', downloadUrl: image.signedUrl } : null}
  onViewMapPlan={() => { setPlanDetailsOpen(true); setRightOpen(true); }}
/>
```

- [ ] **Step 3: Update Map unit/E2E tests after the implementation.** Restore the pre-globalization chat interaction assertions; change static wiring checks to require `MapChatPanel` and retain assertions for the agent refresh bridge.
- [ ] **Step 4: Verify Task 1.** Run `npx jest --runInBand tests/unit/create-map/map-chat-panel.test.tsx tests/unit/create-map/workbench-wiring.test.tsx` and `npm run typecheck`. Expected: zero failed tests and no TypeScript errors.

### Task 2: Put the assistant in the product rail

**Files:**
- Modify: `src/components/layout/DashboardLayout.tsx`
- Modify: `src/components/layout/LeftNav.tsx`
- Modify: `src/components/layout/LeftNav.module.css`
- Modify: `src/components/agent/AssistantHost.tsx`
- Modify: `src/components/agent/ChatPanel.tsx`
- Modify: `src/components/agent/ChatPanel.module.css`
- Test: `tests/unit/agent/assistant-host.test.tsx`
- Test: `tests/unit/agent/assistant-route-coverage.test.ts`
- Test: `tests/e2e/specs/agent-chat.spec.ts`

**Interfaces:** `DashboardLayout` owns `assistantOpen: boolean`; `LeftNav` accepts `assistantAvailable`, `assistantOpen`, and `onAssistantToggle`; `AssistantHost` accepts `open` and `onOpenChange`; `ChatPanel` receives these controlled props. A route/scope switch closes the panel without deleting the scoped conversation runtime.

- [ ] **Step 1: Lift panel state to `DashboardLayout` and mount the rail for supported routes.** Compute `assistantAvailable` with `deriveAgentWorkspaceContext(pathname, navigation, preference)` or a shared route predicate derived from the same rules. Do not show the rail bot on excluded routes.
- [ ] **Step 2: Add one bot button to `LeftNav` above the collapse control.** Use existing `bot.svg`, `aria-label="Keco Assistant"`, `aria-pressed={assistantOpen}`, and `data-testid="agent-launcher"`. Button toggles `onAssistantToggle` and shares existing rail item dimensions.
- [ ] **Step 3: Make `AssistantHost` and `ChatPanel` controlled.** Remove the floating launcher and draggable-position hook. Preserve lazy chat loading by passing the controlled `open` value to `useAgentChat(ctx, open)`; reset open state on navigation while preserving the runtime store.
- [ ] **Step 4: Update CSS and tests after implementation.** Remove floating-launcher styling, keep desktop side-panel and mobile full-width panel rules, and verify one launcher per supported route, none on excluded routes, open/close, and route reset.
- [ ] **Step 5: Verify Task 2.** Run `npx jest --runInBand tests/unit/agent/assistant-host.test.tsx tests/unit/agent/assistant-route-coverage.test.ts` and `npm run typecheck`. Expected: zero failed tests and no TypeScript errors.

### Task 3: Browser verification and unified review

**Files:**
- Modify only tests or affected UI files if browser review identifies a concrete defect.

- [ ] **Step 1: Run Create Map and Agent Chat Playwright suites.** Run `npm run test:e2e:create-map-v3` and `npx playwright test tests/e2e/specs/agent-chat.spec.ts --workers=1` with the local Supabase fixtures required by those suites. Expected: all targeted cases pass.
- [ ] **Step 2: Inspect desktop/mobile screenshots.** Check Map chat, rail alignment, open assistant, canvas/inspector width, mobile overlap, and keyboard focus.
- [ ] **Step 3: Run `npm run lint`, `npm run typecheck`, `git diff --check`, and a production build.** Expected: zero errors.
- [ ] **Step 4: Perform one unified code review of the entire UI diff.** Resolve Critical/Important findings and rerun affected checks.
- [ ] **Step 5: Commit the verified UI changes on `codex/ai-map-ui-parity`.** Do not push or merge without a separate user request.
