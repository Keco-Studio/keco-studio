---
name: keco-convert-document-to-script
description: Convert nonstandard story documents into the established Keco Script text syntax for Dialogue and Flow Chart editing, without inventing story branches.
---

# Convert Document to Script

Read [the existing Script grammar](references/script-grammar.md) before converting.
Use whole-line **bold titles**, whole-line *italic scene/action descriptions*, and `Speaker: dialogue` without outer quotes. Use ASCII syntax punctuation. Preserve the user's original language, dialogue, actions, speakers, existing choices and variable effects. Return Script text, not JSON and not Type-prefixed dialogue. Do not invent branches or require users to edit source syntax or acknowledge pending-confirmation markers.

Use the connected Keco import capability when available. Discover its current contract before calling it; do not invent MCP operation names. The application's existing `import_script` Agent tool and `/api/import-script` action use the text conversion service. Supply the exact source and selected project/destination through the supported tool, letting the service validate, repair and persist the result. Do not use direct SQL or bypass source snapshot checks.

If no connected import capability is available, produce a Script text artifact using the grammar and clearly state that it has not been imported. Never claim a generated text file has been saved to Keco.

The application converter parses the model's Script text, checks references and source content, retries invalid output at most twice, and refuses to persist a successful import if conversion cannot be validated; the original source is retained for retry. Cancellation and empty input are not successful conversions. No approval or confirmation labels are added to individual lines.

Keep Dialogue and Flow Chart as the editing surfaces. After import, users can edit dialogue, choices and connections there, or ask AI for a scoped change. Use the existing update tools and latest version for later edits; do not rerun import over an existing script without a user request.
