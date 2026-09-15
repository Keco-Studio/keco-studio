# Keco Studio Desktop WebView Shell Design

## Goal

Provide Keco Studio as a downloadable desktop entry point while retaining the
existing deployed Next.js product as the sole UI, application server, identity
provider, and data source. The desktop application opens the production site at
`https://keco-studio-main.vercel.app`.

This work must not migrate, duplicate, statically export, or otherwise alter
the existing Next.js application, except for the narrowly scoped desktop-mode
marker and Google-login presentation described below.

## Supported Release Targets

The initial release publishes these artifacts through GitHub Releases:

| Platform | Architecture | Artifact | Notes |
| --- | --- | --- | --- |
| Windows | x64 | `.exe` installer | Native SDK Windows directory layout wrapped by Inno Setup. |
| macOS | Apple Silicon (arm64) | `.dmg` | Ad hoc signed, not notarized. |
| macOS | Intel (x64) | `.dmg` | Ad hoc signed, not notarized. |

There are no code-signing credentials in the initial release. Windows may show
a SmartScreen warning. The macOS packages use ad hoc signing, but are not
notarized; users may need to approve them from Finder's context-menu Open flow
or macOS Privacy & Security settings. The release notes must state those
limitations plainly. Adding a Developer ID certificate and notarization later
must be a packaging configuration change, not an application architecture
change.

## Architecture

Add an isolated Native SDK WebView shell under `desktop/`. It owns the native
application manifest, window lifecycle, navigation security policy, icons,
packaging metadata, and platform-specific build integration. The root Next.js
project remains the web product and has no desktop-only runtime dependency.

At launch, the shell opens
`https://keco-studio-main.vercel.app/projects?desktop=1`. It uses the system
web engine on each operating system: WebView2 on Windows and WKWebView on
macOS. It does not bundle a second browser engine, a Next.js server, frontend
assets, Supabase configuration, or application APIs.

The window should use the Keco Studio application name and persist its size and
position. The initial release has no native bridge commands, filesystem access,
notifications, tray behavior, secondary windows, or custom native UI. This
keeps the wrapper intentionally narrow.

## Navigation and Security

The production Keco origin is the only in-window navigation origin:
`https://keco-studio-main.vercel.app`. The initial desktop release supports
email/password authentication only. Google OAuth is deliberately unavailable
in the desktop WebView: Google may reject embedded user agents, and sending the
login to the system browser would not return the WebView's PKCE session without
a dedicated native callback design. Google login remains available in the
ordinary web application and is deferred for desktop until that callback flow
is designed and tested. A minimal client component mounted by the root Next.js
layout records the `desktop=1` query marker in session storage before a page
redirect can discard it. The existing login page reads that session marker and
hides the Google login control with a short desktop-specific explanation. This
is the sole required web-product change; it does not duplicate the UI or alter
any server route, API, or auth provider configuration.

All other top-level navigation is denied. The first release also denies
`target=\"_blank\"`, `window.open`, and custom-protocol navigation rather than
silently navigating the main WebView or relying on platform-specific popup
behavior. The existing web app is not changed to create a desktop link bridge.
This constraint is intentional until external-link handling has a tested,
cross-platform implementation.

No Native SDK permission or bridge capability is enabled unless a later feature
has a specific need. Authentication remains website authentication; cookies and
sessions are scoped to the system WebView profile rather than copied from the
user's browser. Release acceptance includes email/password login, logout,
application restart, and session restoration checks.

## Delivery Pipeline

A manually dispatchable GitHub Actions release workflow is added. It accepts a
release version and builds each target on its matching host runner. Each job
validates the desktop manifest, produces and checks its platform artifact, then
uploads it only as a private Actions artifact. A final publish job requires all
three jobs to succeed, verifies their versions and architecture names, then
creates a draft GitHub Release and uploads all three release assets. It verifies
the uploaded asset count and names before publishing the draft. A failure leaves
only a non-public draft for maintainers to repair or delete, never an incomplete
public release.

The Windows job packages the Native SDK distributable directory with Inno Setup
into an x64 per-user installer. It installs below the current user's writable
`LocalAppData\\Programs` location rather than Program Files, so the SDK's
default WebView2 profile location next to the executable is writable without
administrator rights. It detects the Evergreen WebView2 Runtime and runs a
pinned Microsoft bootstrapper when the runtime is missing. Installation and
first launch are tested as an ordinary user.

The macOS jobs produce separately named arm64 and x64 ad-hoc-signed DMGs.

Because Native SDK 0.10.1 does not expose a cross-platform manifest-only hook
for WebView `NewWindowRequested`, the shell owns a small, pinned host patch (or
uses a later SDK release with the equivalent hook) that cancels popup creation
before any new window is made. The patch is checked into `desktop/patches/`,
applied reproducibly in CI, and covered by the same navigation tests on Windows
and macOS. No wildcard navigation policy is acceptable.

The workflow must not require production secrets: the desktop shell only embeds
the public production URL. It should use pinned, reproducible tool versions
where the available packaging tools allow this. A failed target build must fail
the release rather than publish a partial release silently.

## Failure Behavior

When the production site is unavailable, the WebView displays its normal
network failure state. The shell does not implement offline data caching or a
local fallback, because the product depends on online server APIs and auth.
Build and packaging failures surface in the corresponding GitHub Actions job
with the relevant command output.

## Verification

- Validate the Native SDK manifest and build the desktop shell for each target.
- Confirm the WebView loads the production URL in development mode.
- Verify email/password login, logout, and a restored authenticated session
  after restart. Confirm Google OAuth is blocked in the desktop app with a
  clear website-provided error or disabled control. Cover both a fresh session
  and an already-authenticated launch followed by logout.
- Verify navigation policy for same-origin links, redirects, a normal external
  URL, `target=\"_blank\"`, `window.open`, and a custom protocol. No external
  origin may leave the Keco origin inside the main WebView; all other cases must
  be denied predictably, with popup tests asserting that no new window is made.
- Install, start, and uninstall the Windows x64 installer as a non-admin user;
  verify WebView2 Runtime detection and the writable WebView profile.
- Install and start both macOS DMGs on their matching architecture; inspect the
  actual binary architecture as well as the bundle structure.
- Confirm the three target jobs publish only Actions artifacts and the final
  release job publishes exactly three correctly named release assets after all
  target checks pass.

## Out of Scope

- Rewriting any Next.js view in Native markup.
- Running the Next.js server, database, or Supabase locally in the desktop app.
- Offline mode, automatic updates, Developer ID signing, notarization, telemetry, native
  menus, filesystem integration, and native bridge APIs.
