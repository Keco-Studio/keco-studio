# UI Flow Contracts – Playwright authentication and workspace state tests

Format: intent, entry, steps, expected results.

## Login (seeded persona)
- Entry: visit `/login` (or landing redirects to auth form)
- Steps: fill email/password; submit
- Expected: redirected to dashboard; header/nav visible; dashboard content matches persona state (empty/project/library)

## Registration (new account)
- Entry: `/register` (or toggle to sign up)
- Steps: provide unique email + strong password; submit
- Expected: account created and authenticated; dashboard shows empty-state CTA to create project

## Create Project
- Entry: dashboard empty-state CTA or “New Project” control
- Steps: open create form; fill name (required) and optional description; submit
- Expected: project card appears with name/description; no errors shown; empty-state hidden

## Create Library
- Entry: inside a project card with zero libraries; choose “New Library” control
- Steps: open create form; fill name (required) and optional description; submit
- Expected: library entry appears under project; actions available for the library

## Delete Library
- Entry: project with at least one library
- Steps: trigger delete on a library; confirmation modal appears; confirm
- Expected: library removed from list; project reflects zero libraries state; errors handled if API fails

## Delete Project
- Entry: project card present
- Steps: trigger delete on project; confirmation modal appears; confirm
- Expected: project removed; if it was last, dashboard shows empty-state prompt; errors handled if API fails

## Auth Error Handling
- Entry: login form with incorrect password
- Steps: submit invalid credentials
- Expected: visible error message; user remains unauthenticated; no redirect to dashboard
