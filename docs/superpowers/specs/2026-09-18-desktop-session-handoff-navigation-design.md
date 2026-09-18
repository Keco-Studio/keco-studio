# Desktop Session Handoff Navigation

## Goal

After native Google OAuth hands a valid session to the desktop WebView, navigate to the projects home page without requiring an application restart.

## Cause

The handoff page starts a Next.js client navigation with `router.replace('/projects')` and then immediately replaces browser history to remove the token fragment. These separate navigation mechanisms can race in WebView2. The session has already been stored in cookies, which is why reopening the application succeeds.

## Design

After `supabase.auth.setSession` succeeds, the handoff page will perform one browser-level replacement to `/projects?desktop=1`. This removes the sensitive fragment as part of the same navigation and retains desktop-mode detection. The page will no longer use Next.js router navigation or a separate history mutation.

## Scope

- Update the desktop session handoff page only.
- Add a regression test that prevents reintroducing split navigation.
- Run the focused unit test and typecheck before release.

## Error Handling

Invalid handoff fragments and `setSession` failures continue to render the existing retryable error state.
