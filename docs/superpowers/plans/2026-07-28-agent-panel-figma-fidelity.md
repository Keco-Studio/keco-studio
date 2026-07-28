# Agent Panel Figma Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the existing Keco Agent launcher and panel to match the Figma Agent states without changing chat, history, Confirm/Auto, confirmation, attachment, or streaming behavior.

**Architecture:** Keep `ChatPanel` and `useAgentChat` as the state/runtime boundary. Extract the header chrome into a small presentational component for deterministic rendering tests, then refine existing Agent child markup and the shared CSS module. The panel continues to overlay the dashboard and becomes full-width on narrow screens.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS Modules, Ant Design icons, Jest SSR component tests, Playwright.

---

### Task 1: Agent panel header and empty state

**Files:**
- Create: `src/components/agent/AgentPanelHeader.tsx`
- Create: `tests/unit/agent/agent-panel-header.test.tsx`
- Modify: `src/components/agent/ChatPanel.tsx:3-332`
- Modify: `src/components/agent/ChatPanel.module.css:28-125`

- [ ] **Step 1: Write the failing header rendering test**

Create a server-rendered component test that requires accessible icon actions,
the current mode label, scope text, and the active history state:

```tsx
const html = renderToStaticMarkup(
  <AgentPanelHeader
    autoExecute={false}
    historyOpen
    isStreaming={false}
    scopeLabel="skills"
    scopeLocked
    onToggleMode={() => undefined}
    onNew={() => undefined}
    onHistory={() => undefined}
    onClose={() => undefined}
  />
);

expect(html).toContain('Keco Agent');
expect(html).toContain('Confirm');
expect(html).toContain('skills');
expect(html).toContain('aria-label="Start new chat"');
expect(html).toContain('aria-label="Open chat history"');
expect(html).toContain('aria-pressed="true"');
expect(html).toContain('aria-label="Close Keco Agent"');
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run test:unit -- --runInBand tests/unit/agent/agent-panel-header.test.tsx`

Expected: FAIL because `AgentPanelHeader` does not exist.

- [ ] **Step 3: Implement the header component and integrate it**

Use existing Ant Design glyphs and text only where the design calls for a
labelled mode command:

```tsx
<header className={styles.header}>
  <div className={styles.headerIdentity}>
    <span className={styles.agentMark} aria-hidden="true">K</span>
    <div className={styles.headerTitleGroup}>
      <span className={styles.headerTitle}>Keco Agent</span>
      {scopeLabel ? <span className={styles.scopeLock}>{scopeLocked ? 'Locked to ' : ''}{scopeLabel}</span> : null}
    </div>
  </div>
  <div className={styles.headerActions}>
    <button className={styles.modeToggle}>{autoExecute ? 'Auto' : 'Confirm'}</button>
    <button aria-label="Start new chat"><PlusOutlined /></button>
    <button aria-label="Open chat history" aria-pressed={historyOpen}><HistoryOutlined /></button>
    <button aria-label="Close Keco Agent"><CloseOutlined /></button>
  </div>
</header>
```

Replace the inline header in `ChatPanel` with this component. Keep all existing
callbacks and disabled conditions. Replace the plain empty paragraph with a
compact branded empty state containing a title and one-line prompt, without
adding onboarding instructions or changing runtime behavior.

- [ ] **Step 4: Run the focused test**

Run: `npm run test:unit -- --runInBand tests/unit/agent/agent-panel-header.test.tsx`

Expected: PASS.

### Task 2: Composer, activity, history, and confirmation presentation

**Files:**
- Modify: `src/components/agent/ChatInput.tsx:307-449`
- Modify: `src/components/agent/AgentActivityBar.tsx:21-26`
- Modify: `src/components/agent/ConversationList.tsx:83-116`
- Modify: `src/components/agent/ConfirmationCard.tsx:313-400`
- Modify: `tests/unit/agent/document-confirmation-ui.test.tsx`
- Modify: `src/components/agent/ChatPanel.module.css:357-779`

- [ ] **Step 1: Add failing confirmation accessibility assertions**

Extend the existing confirmation component test:

```tsx
expect(markup).toContain('role="group"');
expect(markup).toContain('aria-label="Confirmation required"');
expect(markup).toContain('aria-label="Approve action"');
expect(markup).toContain('aria-label="Reject action"');
```

- [ ] **Step 2: Run the confirmation test and verify it fails**

Run: `npm run test:unit -- --runInBand tests/unit/agent/document-confirmation-ui.test.tsx`

Expected: FAIL because the current card and buttons do not expose these labels.

- [ ] **Step 3: Implement the Figma-aligned child states**

Keep the existing values and handlers while changing presentation:

```tsx
<div className={styles.confirmCard} role="group" aria-label="Confirmation required">
  <div className={styles.confirmEyebrow}>Confirmation required</div>
  <div className={styles.confirmTitle}>{label}</div>
  {/* existing argument, preview, diff, and resolved content */}
  <button aria-label="Approve action">Confirm</button>
  <button aria-label="Reject action">Cancel</button>
</div>
```

Use an icon-only send button with `SendOutlined`, keep `data-testid="agent-send"`,
and add `aria-label="Send message"`. Keep attachment uploads, textarea draft
persistence, Enter/Shift+Enter behavior, and disabled logic unchanged. Render
the activity row as compact thinking feedback above the composer. Add a History
heading and close affordance supplied by the existing header toggle; history
items become real buttons with a separate icon-only delete button so keyboard
interaction no longer depends on clickable `div` elements.

- [ ] **Step 4: Run the focused unit tests**

Run: `npm run test:unit -- --runInBand tests/unit/agent/document-confirmation-ui.test.tsx tests/unit/agent/assistant-message.test.tsx`

Expected: PASS, including the user's existing assistant-message changes.

### Task 3: Responsive visual system and end-to-end verification

**Files:**
- Modify: `src/components/agent/ChatPanel.module.css`
- Modify: `tests/e2e/pages/agent.page.ts`
- Modify: `tests/e2e/specs/agent-chat.spec.ts`

- [ ] **Step 1: Add Figma-state locators and assertions**

Expose stable locators for mode and history in `AgentPage`, then assert:

```ts
await expect(agent.panel).toBeVisible();
await expect(agent.modeToggle).toHaveText('Confirm');
await expect(agent.input).toHaveAttribute('placeholder', /Ask Keco Agent/);
await agent.historyButton.click();
await expect(page.getByTestId('agent-conversation-list')).toBeVisible();
```

- [ ] **Step 2: Run the focused Playwright test to establish the baseline**

Run: `npx playwright test tests/e2e/specs/agent-chat.spec.ts --grep "renders a streamed assistant response" --workers=1`

Expected: Existing behavior passes before CSS changes; new visual-state assertions
fail until the markup changes are complete.

- [ ] **Step 3: Implement the responsive CSS tokens and layout**

Define Agent-local custom properties on `.panel` for the Figma palette and use
them consistently:

```css
.panel {
  --agent-blue: #1687ff;
  --agent-blue-hover: #0877eb;
  --agent-ink: #1f2a37;
  --agent-muted: #7a8798;
  --agent-line: #e8edf3;
  width: 336px;
  max-width: 100vw;
  background: #fff;
}

@media (max-width: 680px) {
  .panel { width: 100vw; }
  .header { padding-inline: 12px; }
  .headerActions { gap: 2px; }
}
```

Apply stable dimensions to the launcher, header icon buttons, mode switch,
composer controls, and send button. Use 6px or smaller radii, light neutral
borders, white message canvas, compact 12-14px type, focus-visible outlines,
and reduced-motion overrides. Do not change dashboard CSS.

- [ ] **Step 4: Run verification**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/agent/agent-panel-header.test.tsx tests/unit/agent/document-confirmation-ui.test.tsx tests/unit/agent/assistant-message.test.tsx
npm run typecheck
npx playwright test tests/e2e/specs/agent-chat.spec.ts --workers=1
```

Expected: focused Jest tests, TypeScript, and Agent Playwright tests pass.

- [ ] **Step 5: Validate desktop and mobile screenshots**

Start the existing Next.js dev server, capture the Agent launcher and open panel
at 1523x985 and 390x844, and confirm the panel is nonblank, does not overlap its
own controls, keeps the composer visible, and does not resize the underlying
dashboard.
