# Agent Chat Markdown and Reasoning Summary Design

## Goal

Render assistant replies as Markdown, including GFM tables, while presenting one
assistant summary bubble per user turn. During reasoning, the bubble shows a
short live summary with a thinking state and allows the full reasoning text to
be expanded.

## Scope

- Render assistant reply Markdown: paragraphs, emphasis, strong text, lists,
  links, code, block quotes, separators, and GFM tables.
- Ignore whitespace-only reasoning and text stream deltas.
- Reuse one assistant bubble across all model iterations in a user turn.
- Keep tool and confirmation cards as independent items.
- Merge persisted assistant messages from the same user turn into one reply
  when conversation history is restored.

Reasoning persistence across a page reload is not included. The existing data
model does not persist provider reasoning, so restored conversations continue
to show the merged final assistant reply and tool cards only.

## Markdown Rendering

Add `react-markdown` and `remark-gfm` as direct dependencies. Assistant text is
rendered through a dedicated component rather than inserted as HTML. Raw HTML
remains disabled, which prevents model output from executing markup or scripts.

The renderer uses scoped chat styles. Tables are wrapped in a horizontally
scrollable container so they remain usable inside the 420 px agent panel.
Headings, paragraphs, lists, code, block quotes, links, and separators receive
compact spacing appropriate for chat bubbles. External links open in a new tab
with `noopener noreferrer`.

## Streaming and Turn Aggregation

The stream consumer keeps one stable assistant item id for the entire request.
Tool call boundaries no longer discard that id.

- A whitespace-only reasoning delta does not create an assistant item.
- The first meaningful reasoning or text delta creates the assistant item.
- Reasoning from later model iterations appends to the same item, separated by
  a paragraph boundary when necessary.
- Visible text from later iterations appends to the same item, also with a
  paragraph boundary so chunks from separate model calls do not run together.
- Tool and confirmation events still append their own cards.
- When final visible text starts after tool activity, the existing assistant
  item moves to the end of the current turn so the final reply appears after
  the tool cards.
- If a turn contains no meaningful reasoning or text, no empty assistant
  bubble remains after the stream finishes.

## Reasoning Summary

The collapsed reasoning control uses a deterministic client-side summary. It
selects the latest complete, non-empty sentence or line from accumulated
reasoning, removes lightweight Markdown markers, normalizes whitespace, and
truncates the result to a compact label.

While reasoning is active, the label is `<summary> (Thinking...)`. After
reasoning ends, the activity suffix is removed. Clicking the control expands
the complete reasoning content. The duration remains available as secondary
text so the summary itself is the primary label.

This approach avoids an additional LLM request, latency, cost, and failure mode
for every streamed response.

## History Restoration

History mapping treats each user message as the start of a new turn. Within the
turn it collects assistant text and tool results, emits tool cards in their
original order, and emits one merged assistant reply after those cards. Empty
assistant messages and orphaned empty tool-call shells remain hidden.

## Error Handling

- Malformed Markdown is rendered as the parser's best-effort plain content.
- Empty or punctuation-only reasoning falls back to the existing generic
  thinking label and never creates a standalone blank bubble.
- Stream errors remain separate error items and do not erase accumulated reply
  content.

## Testing

Unit and component tests cover:

- strong text and GFM table rendering;
- safe handling of raw HTML;
- horizontal table wrapper markup;
- reasoning summary extraction and truncation;
- whitespace-only reasoning not creating an item;
- one assistant item across multiple model/tool iterations;
- final assistant placement after tool cards;
- history restoration merging assistant messages per user turn;
- existing tool-card and confirmation behavior.

Run focused Jest tests, TypeScript checking, and the agent chat Playwright case
when the local test environment is available.
