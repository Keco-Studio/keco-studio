# Keco Studio Desktop WebView Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Native SDK desktop entry point that loads the deployed Keco Studio Next.js product and produces Windows x64 and macOS x64/arm64 release artifacts.

**Architecture:** A tiny Next.js desktop-mode marker disables unavailable Google OAuth in the existing login UI. An isolated Zig/Native SDK WebView shell opens the production `/projects?desktop=1` URL and has no bundled frontend or native bridge. GitHub Actions builds platform artifacts privately, then a final job publishes one complete draft-verified GitHub Release.

**Tech Stack:** Next.js 16/React 19, TypeScript/Jest, Native SDK 0.10.1/Zig 0.16, WebView2/WKWebView, Inno Setup, GitHub Actions.

## Global Constraints

- Production entry URL is exactly `https://keco-studio-main.vercel.app/projects?desktop=1`.
- Existing Next.js UI, API routes, Supabase configuration, and server behavior remain unchanged except for desktop-mode marker handling and the Google-login presentation.
- The desktop app enables no bridge commands, filesystem permissions, tray, notifications, secondary windows, or offline cache.
- The manifest's only top-level in-window origin is `https://keco-studio-main.vercel.app`; no wildcard origin is allowed.
- Desktop mode supports email/password auth only; Google OAuth must be unavailable in the desktop login UI.
- Windows artifact is a per-user x64 `.exe` installer below `LocalAppData\\Programs`, with WebView2 Runtime detection.
- macOS artifacts are distinct arm64 and x64 ad-hoc-signed, non-notarized `.dmg` files.
- SDK popup handling is patched against exactly `@native-sdk/cli@0.10.1`; patch application must fail if the expected upstream source changes.
- Target build jobs upload only private workflow artifacts. Only a final job may publish a draft-verified public GitHub Release containing all three assets.

---

## File Structure

- `src/lib/desktopMode.ts`: desktop query-marker parsing and session key.
- `src/components/desktop/DesktopModeMarker.tsx`: browser-only marker persistence component.
- `src/components/authform/AuthForm.tsx`: hides Google OAuth in desktop mode.
- `src/app/layout.tsx`: mounts the marker before application providers.
- `tests/unit/auth/desktop-mode.test.ts`: unit and source-integration coverage for the marker and login behavior.
- `desktop/`: standalone Native SDK project with its own package lock, manifest, source, build graph, asset, patch, installer definition, and validation scripts.
- `.github/workflows/release-desktop.yml`: manual Windows/macOS build matrix plus all-or-nothing release publication.
- `docs/desktop.md`: end-user download, install, first-run, and unsigned-app instructions.

### Task 1: Add Desktop-Mode Login Guard

**Files:**
- Create: `src/lib/desktopMode.ts`
- Create: `src/components/desktop/DesktopModeMarker.tsx`
- Create: `tests/unit/auth/desktop-mode.test.ts`
- Modify: `src/app/layout.tsx`
- Modify: `src/components/authform/AuthForm.tsx`

**Interfaces:**
- Produces `DESKTOP_MODE_STORAGE_KEY`, `isDesktopModeSearch(search)`, and `isDesktopModeSession(storage)` from `src/lib/desktopMode.ts`.
- `DesktopModeMarker` calls `sessionStorage.setItem(DESKTOP_MODE_STORAGE_KEY, '1')` only when `desktop=1` is present in the current URL.
- `AuthFormContent` renders the Google OAuth button only when `isDesktopModeSession(window.sessionStorage)` is false.

- [ ] **Step 1: Write the failing helper and integration test.**

```ts
import { DESKTOP_MODE_STORAGE_KEY, isDesktopModeSearch } from '@/lib/desktopMode';

describe('desktop mode', () => {
  it('recognizes only desktop=1', () => {
    expect(isDesktopModeSearch('?desktop=1')).toBe(true);
    expect(isDesktopModeSearch('?desktop=0')).toBe(false);
    expect(isDesktopModeSearch('?other=1')).toBe(false);
  });

  it('mounts the marker in the root layout and suppresses Google OAuth in the auth form', () => {
    expect(read('src/app/layout.tsx')).toContain('<DesktopModeMarker />');
    expect(read('src/components/authform/AuthForm.tsx')).toContain(DESKTOP_MODE_STORAGE_KEY);
    expect(read('src/components/authform/AuthForm.tsx')).toMatch(/!isDesktopMode[\s\S]*Log in using Google/);
  });
});
```

- [ ] **Step 2: Run the test to verify RED.**

Run: `npm test -- --runInBand tests/unit/auth/desktop-mode.test.ts`

Expected: failure because `@/lib/desktopMode` and the marker integration do not exist.

- [ ] **Step 3: Implement the smallest safe marker.**

`desktopMode.ts` defines `DESKTOP_MODE_STORAGE_KEY = 'keco-desktop-mode'`, parses `URLSearchParams`, and reads a passed `Storage` object. `DesktopModeMarker` is a client component using `useEffect`; it stores the marker when the URL search query contains `desktop=1`. Mount it as the first body child in `RootLayout`.

`AuthFormContent` derives `isDesktopMode` after mount from `isDesktopModeSession(window.sessionStorage)`. Replace the OAuth section with an explanatory text node in desktop mode; do not invoke `handleGoogleLogin` or alter password registration/login behavior.

- [ ] **Step 4: Run focused and regression tests.**

Run:

```bash
npm test -- --runInBand tests/unit/auth/desktop-mode.test.ts tests/unit/auth/dashboard-layout-auth-gate.test.ts tests/unit/auth/session-cookie-security-static.test.ts
```

Expected: all named suites pass.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/desktopMode.ts src/components/desktop/DesktopModeMarker.tsx src/app/layout.tsx src/components/authform/AuthForm.tsx tests/unit/auth/desktop-mode.test.ts
git commit -m "feat: mark desktop webview sessions"
```

### Task 2: Create the Reproducible Native SDK Shell

**Files:**
- Create: `desktop/app.json`
- Create: `desktop/build.zig`, `desktop/build.zig.zon`, `desktop/src/main.zig`, `desktop/src/runner.zig`
- Create: `desktop/package.json`, `desktop/package-lock.json`
- Create: `desktop/assets/icon.png`
- Create: `desktop/scripts/resolve-native-sdk-path.mjs`
- Create: `desktop/scripts/apply-native-sdk-patches.mjs`
- Create: `desktop/patches/native-sdk-0.10.1-popup-block.patch`
- Create: `desktop/tests/desktop-shell-static.test.mjs`
- Create: `desktop/README.md`

**Interfaces:**
- `npm --prefix desktop run check` resolves the local locked SDK path, applies the checked-in patch, then runs `native check app.json` and static assertions.
- `src/main.zig` exposes no JavaScript bridge and creates exactly one URL-backed main WebView source.
- The patch script accepts `NATIVE_SDK_PATH`, verifies `package.json` version `0.10.1`, and fails before modifying a source file when the expected patch context is absent.

- [ ] **Step 1: Write failing shell static tests.**

Assert the manifest contains the exact production origin, `external_links.action = 'deny'`, a single `main` window with `restore_state: true`, `platforms: ['macos', 'windows']`, zero permissions, and `webview` capability. Assert `main.zig` contains the exact production `/projects?desktop=1` URL, no `window.zero`, no `BridgeDispatcher`, and no `frontend` asset source. Assert the patch script rejects an SDK version other than `0.10.1` and the patch adds a `NewWindowRequested` cancellation handler to the Windows host.

- [ ] **Step 2: Run shell tests to verify RED.**

Run: `node --test desktop/tests/desktop-shell-static.test.mjs`

Expected: failure because the desktop project and patch do not exist.

- [ ] **Step 3: Scaffold and reduce the SDK project.**

Run `native init desktop --frontend next` once to obtain the SDK-owned Zig build graph, then remove the generated `frontend/` tree and all frontend install/build/asset dependencies from its build graph. Replace the generated source callback with:

```zig
const production_url = "https://keco-studio-main.vercel.app/projects?desktop=1";

fn source(_: *anyopaque) anyerror!native_sdk.WebViewSource {
    return native_sdk.WebViewSource.url(production_url);
}
```

Keep the generated runner and platform linking rules. Replace its machine-specific default SDK path with the `-Dnative-sdk-path` build option supplied by `resolve-native-sdk-path.mjs`. Pin `@native-sdk/cli` to `0.10.1` in `desktop/package.json`; do not use a global CLI path.

- [ ] **Step 4: Add the popup patch and reproducible validation.**

The patch adds the WebView2 `NewWindowRequested` event IID and registration next to the existing `NavigationStarting` registration in `webview2_host.cpp`; its handler calls the `ICoreWebView2NewWindowRequestedEventArgs::put_Handled(TRUE)` API without creating a window or opening an external browser. The patch script applies it exactly once and exits nonzero if either the package version or the source anchor differs. The macOS host remains under the manifest's deny policy and its runtime behavior is exercised by platform release testing.

- [ ] **Step 5: Run focused checks.**

Run:

```bash
npm --prefix desktop ci
npm --prefix desktop run check
node --test desktop/tests/desktop-shell-static.test.mjs
```

Expected: all checks pass. On this Linux workstation, `native doctor --manifest desktop/app.json` may report missing GTK/WebKit; record that as a host prerequisite rather than weakening the macOS/Windows target configuration.

- [ ] **Step 6: Commit.**

```bash
git add desktop
git commit -m "feat: add native desktop webview shell"
```

### Task 3: Add Windows Installer and All-or-Nothing Release Workflow

**Files:**
- Create: `desktop/installer/KecoStudio.iss`
- Create: `desktop/scripts/assert-release-assets.mjs`
- Create: `.github/workflows/release-desktop.yml`
- Create: `docs/desktop.md`
- Create: `tests/unit/desktop-release-workflow-static.test.ts`

**Interfaces:**
- `KecoStudio.iss` installs per-user into `{localappdata}\Programs\Keco Studio`, creates a Start Menu shortcut and uninstall entry, and invokes a bundled/pinned WebView2 bootstrapper only when the runtime registry detection reports absent.
- `assert-release-assets.mjs <version> <directory>` requires exactly `Keco-Studio-Setup-<version>-windows-x64.exe`, `Keco-Studio-<version>-macos-arm64.dmg`, and `Keco-Studio-<version>-macos-x64.dmg`.
- Release workflow has three platform build jobs and one publish job requiring all three.

- [ ] **Step 1: Write failing release workflow assertions.**

Assert the workflow uses `workflow_dispatch` with a version input; contains Windows x64, macOS arm64, and macOS x64 jobs; uses `actions/upload-artifact@v4` in build jobs; uses `actions/download-artifact@v4` in the publish job; creates a draft release; runs asset assertion before publication; and contains no `gh release create` in an individual build job. Assert the Inno definition uses `PrivilegesRequired=lowest`, `{localappdata}\Programs`, `WebView2`, `ArchitecturesInstallIn64BitMode=x64`, and `uninsdelete` cleanup.

- [ ] **Step 2: Run test to verify RED.**

Run: `npm test -- --runInBand tests/unit/desktop-release-workflow-static.test.ts`

Expected: failure because the installer and workflow do not exist.

- [ ] **Step 3: Implement installer and release workflow.**

Use the Windows job on `windows-2022`, macOS Intel on `macos-13`, and Apple Silicon on `macos-14`. Install the pinned Node, Zig 0.16, Native SDK dependencies, and Inno Setup only in their appropriate job. Build one package per job, rename it to the required asset name, validate architecture (`dumpbin`/PowerShell on Windows; `lipo -archs` on macOS), and upload it as an Actions artifact.

The publish job downloads all artifacts, runs `assert-release-assets.mjs`, creates a draft release with `gh release create <tag> --draft`, uploads all three assets, queries the release asset names to run the same assertion, then publishes only after the count and names match. Give the workflow `contents: write` permission only for the final publish job. Do not require Vercel, Supabase, or production secrets.

Document download instructions, the unsigned Windows SmartScreen and macOS Privacy & Security prompts, email/password-only desktop login, the intentional no-external-link behavior, and the fact that users download the Windows `.exe` from GitHub Releases to their own desktop.

- [ ] **Step 4: Run workflow and installer validations.**

Run:

```bash
npm test -- --runInBand tests/unit/desktop-release-workflow-static.test.ts
node desktop/scripts/assert-release-assets.mjs 0.1.0 /tmp/keco-desktop-assets-missing
git diff --check
```

Expected: the Jest test passes; the asset assertion exits nonzero with a clear missing-assets message for the empty temporary directory; `git diff --check` has no output.

- [ ] **Step 5: Commit.**

```bash
git add desktop/installer desktop/scripts/assert-release-assets.mjs .github/workflows/release-desktop.yml docs/desktop.md tests/unit/desktop-release-workflow-static.test.ts
git commit -m "ci: publish desktop release artifacts"
```

### Task 4: Full Verification and Release Handoff

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a concise link to `docs/desktop.md` under deployment documentation.**

- [ ] **Step 2: Run all locally available validation.**

Run:

```bash
npm test -- --runInBand tests/unit/auth/desktop-mode.test.ts tests/unit/desktop-release-workflow-static.test.ts
npm run lint
npm run typecheck
npm --prefix desktop run check
git diff --check
```

Expected: every command exits `0`.

- [ ] **Step 3: Validate the GitHub Actions workflow syntax and release-contract test.**

Run the workflow through a manually dispatched GitHub Actions run with a prerelease version. Require all three platform jobs and the publish job to be green before sharing release URLs. On target machines, install and launch all final artifacts, verify normal-user Windows install and WebView2 detection, desktop login/logout/session restoration, denied popups/external navigation, and matching macOS architectures.

- [ ] **Step 4: Commit.**

```bash
git add README.md
git commit -m "docs: link desktop release guide"
```
