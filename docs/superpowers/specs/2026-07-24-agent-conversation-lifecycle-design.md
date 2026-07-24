# Agent Conversation Lifecycle Design

## Goal

Keep an Agent turn running when the user closes the panel, opens another conversation, or navigates to another project. A conversation's input remains disabled until its own turn finishes.

## Design

The browser keeps a small runtime registry keyed by authenticated user and conversation. Each runtime owns its messages, history-loading flag, streaming flag, activity, start time, scope, and mode. Each user/project pair separately remembers which runtime is selected.

New conversations use a temporary runtime key. When the API returns `X-Conversation-Id`, the registry rekeys that runtime without losing streamed state. SSE handlers always update the runtime that started the request, never whichever conversation happens to be visible later.

Navigation, New, and History selection only switch the visible runtime. They invalidate stale automatic restores but do not abort Agent fetches or readers. Returning to a running runtime restores its streaming state, so `ChatInput` remains disabled. History loading and authentication hydration also keep input disabled. Since navigation no longer interrupts work, no interruption confirmation is needed for normal project switching.

## Failure Handling

Network and premature-stream errors are appended only to the originating runtime. A failed history request leaves the selected runtime intact. A missing saved conversation clears only that project's saved selection.

## Verification

Unit tests cover project-isolated selections, temporary-to-persisted runtime binding, and independent streaming state. Existing Agent SSE, history, input, type, and lint checks guard integrations.
