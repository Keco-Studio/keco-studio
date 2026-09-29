# Global AI Failure Remediation Design

## Audit conclusion

The reported failures have two different causes. Script and GDS failures are execution and tool-contract problems: the model receives broad discovery tools and oversized context before it can perform the requested targeted operation. Map resize is a capability boundary: the persisted image and collision grid are dimension-bound, so changing dimensions in place would violate the V3 schema.

## Design

### Script

When the bound workspace is `script`, the model receives the Script-specific read and write tools needed for the current task and does not receive broad project enumeration or semantic retrieval tools for the same turn. The active Script read returns each persisted row UUID (`nodeId`). Dialogue edits use that UUID and are previewed before the atomic graph write. Structural graph edits continue to use labels and a fresh graph read. The prompt explicitly makes the current library the first lookup target and forbids re-listing the project for a targeted edit.

### Create Map

The Agent gets a bounded `read_map_detail` tool and a confirmed `update_map_draft` tool. The update tool accepts the current Map Plan fields that the UI edits directly: `name`, `summary`, `description`, and generation `seed`. It requires `revisionId`, `saveVersion`, and a content fingerprint and rechecks them before saving. Dimensions, generated images, references, and collision grids remain managed by their dedicated workflows. A dimension change returns a conflict with instructions to create a new draft.

### Game Design System

GDS operations are split into bounded reads, metadata edits (`title`, `summary`, `status`), and version-content edits. Generation remains asynchronous and is not combined with a long editing turn. Each operation reads one exact system/version, applies CAS validation, and returns a bounded result. Source excerpts and pasted Markdown are capped before generation; completion output is capped to keep the request below model context limits.

## Error handling and safety

All writes retain existing role checks and confirmation requirements. Stale revision, save-version, or content-fingerprint inputs fail without writing. Unsupported dimension changes are explicit errors rather than silent partial saves. Embedding failures degrade to exact Script reads and are never retried in the same turn.

## Verification

Add focused tests for Script tool filtering and UUID targeting, Map metadata updates and resize rejection, GDS bounded edit/generation requests, embedding degradation, and route/type contracts. Run the focused Jest suites, TypeScript checks, and `git diff --check`.
