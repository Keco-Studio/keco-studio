# MCP Production Runtime Recovery Design

**Date:** 2026-07-23
**Status:** Approved by the delivery request

## Goal

Make the production Keco MCP endpoint complete OAuth, initialize a real MCP
client, list capabilities, and execute project-bound tools without weakening the
client/project/resource authorization boundary.

## Delivery Sequence

1. Fix the request-context runtime crash caused by invoking
   `crypto.randomUUID` as a detached method. Deploy and verify the real Codex
   happy path before changing authorization again.
2. Replace the unsatisfiable pending-consent grant preparation with a binding
   created from the authorization record and OAuth session during code exchange.
   Restore the runtime grant check after production data proves the binding is
   created.

## Acceptance

- Production Codex completes `initialize`, `tools/list`,
  `keco_connection_probe`, and `list_project_structure`.
- Missing, invalid, non-member, noncanonical, and cross-project requests remain
  denied.
- The bearer token's OAuth client, user, project, resource, and live session are
  checked together on every request.
- No credentials are printed, committed, or stored in test evidence.
