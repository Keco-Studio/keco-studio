# Keco Studio Desktop WebView Shell Design

## Goal

Provide Keco Studio as a downloadable desktop entry point while retaining the
existing deployed Next.js product as the sole UI, application server, identity
provider, and data source. The desktop application opens the production site at
`https://keco-studio-main.vercel.app`.

This work must not migrate, duplicate, statically export, or otherwise alter
the existing Next.js application.

## Supported Release Targets

The initial release publishes these artifacts through GitHub Releases:

| Platform | Architecture | Artifact | Notes |
| --- | --- | --- | --- |
| Windows | x64 | `.exe` installer | Native SDK Windows directory layout wrapped by Inno Setup. |
| macOS | Apple Silicon (arm64) | `.dmg` | Unsigned initial release. |
| macOS | Intel (x64) | `.dmg` | Unsigned initial release. |

There are no code-signing credentials in the initial release. Windows may show
a SmartScreen warning, and macOS users must approve the application via the
Finder context-menu Open flow. The release notes must state those limitations
plainly. Adding certificates and macOS notarization later must be a packaging
configuration change, not an application architecture change.

## Architecture

Add an isolated Native SDK WebView shell under `desktop/`. It owns the native
application manifest, window lifecycle, navigation security policy, icons,
packaging metadata, and platform-specific build integration. The root Next.js
project remains the web product and has no desktop-only runtime dependency.

At launch, the shell opens one main window with the production URL. It uses the
system web engine on each operating system: WebView2 on Windows and WKWebView
on macOS. It does not bundle a second browser engine, a Next.js server, frontend
assets, Supabase configuration, or application APIs.

The window should use the Keco Studio application name and persist its size and
position. The initial release has no native bridge commands, filesystem access,
notifications, tray behavior, secondary windows, or custom native UI. This
keeps the wrapper intentionally narrow.

## Navigation and Security

The production Keco origin is the only in-window navigation origin. Redirects
to external origins must not silently replace the application content. The
shell will use an explicit allowlist for `https://keco-studio-main.vercel.app`
and an external-link policy that hands allowed outside links to the operating
system rather than the WebView.

No Native SDK permission or bridge capability is enabled unless a later feature
has a specific need. Authentication remains website authentication; cookies and
sessions are scoped to the system WebView profile rather than copied from the
user's browser.

## Delivery Pipeline

A manually dispatchable GitHub Actions release workflow is added. It accepts a
release version and builds each target on its matching host runner. Each job
validates the desktop manifest, produces the platform artifact, and uploads it
as a release asset. The Windows job packages the Native SDK distributable
directory with Inno Setup into an x64 installer. The macOS jobs produce
separately named arm64 and x64 DMGs.

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
- Verify navigation policy: production navigation stays in-app and an external
  URL is not rendered inside the app window.
- Inspect Windows installer contents and install/uninstall metadata.
- Inspect both macOS DMGs for distinct architecture labels and application
  bundle structure.
- Confirm the release workflow exposes exactly three correctly named artifacts.

## Out of Scope

- Rewriting any Next.js view in Native markup.
- Running the Next.js server, database, or Supabase locally in the desktop app.
- Offline mode, automatic updates, signing, notarization, telemetry, native
  menus, filesystem integration, and native bridge APIs.
