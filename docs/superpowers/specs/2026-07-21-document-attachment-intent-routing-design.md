# Document Attachment Intent Routing

**Date:** 2026-07-21
**Status:** Approved

## Summary

Document attachments currently use one table-generation prompt regardless of
what the user asks. This causes content questions such as "What is in this
file?" to call project-schema tools and recommend table creation. Separately,
the Agent has no authoritative product-capability statement, so it may describe
its lack of a raw binary-reading tool as if the product cannot upload and parse
DOCX files.

Introduce an explicit document-message intent and a system-prompt capability
manifest. Generic chat attachments use analysis intent, while dedicated table
generation and document-to-table export paths use table intent. The document
body remains parsed on the client and sent to the Agent exactly as it is today.

## Goals

- Answer document content, summary, and explanation questions directly from the
  supplied document content.
- Prevent content-only requests from being forced through project-structure and
  field-type discovery.
- Preserve the existing design-document and project-document table-generation
  workflows.
- Make answers about TXT, Markdown, DOCX, JSON-in-DOCX, images, and legacy DOC
  match the product's implemented capabilities.
- Preserve compact attachment rendering and existing conversation history.
- Make every new document-message producer choose its intent explicitly.

## Non-Goals

- Changing DOCX parsing, image extraction, or document import limits.
- Parsing hidden Word custom XML, custom properties, or arbitrary package
  metadata.
- Adding another LLM call to classify attachment intent.
- Adding a new attachment-mode selector to the chat UI.
- Guaranteeing exact preservation of every Word style or layout feature.
- Changing script import behavior.

## Root Cause

`buildDesignMessage` currently embeds unconditional instructions to call
`list_project_structure` and `list_field_types`, infer libraries, and present a
table plan. These instructions are included even when the user's additional
instruction only asks to read or summarize the file.

The system prompt describes the table-generation workflow but does not provide
one concise, authoritative product capability statement. The model can
therefore answer a generic question such as "Do you support DOCX?" from its own
tool perspective instead of the application's browser-side parsing behavior.

## Message Contract

Add a required intent to the document-message builder:

```ts
export type DocumentMessageIntent = 'analyze' | 'tables';

export interface BuildDesignMessageParams {
  fileName: string;
  documentText: string;
  intent: DocumentMessageIntent;
  documentId?: string;
  additionalInstructions?: string;
  sourceKind?: 'upload' | 'project-document';
}
```

There is no default intent. A required value makes accidental routing visible
at compile time and forces future call sites to make a product decision.

The generated message uses a neutral attachment envelope and includes an
explicit intent marker:

```text
[Document attachment]
[Document intent]
analyze

[User instructions]
What is in this file?

[Document content]
...
```

The file name and source metadata remain in the envelope. The full parsed body
continues to appear after `[Document content]`. `parseDesignMessage` accepts
both the new header and the legacy `[Design document]` header so persisted
conversation history still renders as a compact file chip.

## Intent Semantics

### Analyze

Analysis intent is used by files attached through the general Agent chat input.
The envelope tells the Agent that the application has already parsed the file
and supplied its content. It must:

- follow the user's additional instructions using the supplied content;
- provide a concise content summary when no additional instruction is present;
- avoid claiming that the uploaded file cannot be read;
- avoid project-structure, field-type, or write-tool calls unless the user
  explicitly asks for a project operation; and
- avoid unsolicited table or script-import recommendations.

An explicit table-creation request written in the chat remains actionable. The
system prompt may route that request into the existing table workflow, but a
plain read, summary, explanation, or JSON-inspection request must not enter that
workflow.

### Tables

Table intent is used by:

- the dedicated design-document upload page;
- `Export as tables` from a project document; and
- the server-side reconstruction of a signed document table-export snapshot.

It retains the current behavior: inspect project structure and supported field
types, preserve explicit source tables, apply the quality gate, present a plan,
and use the existing table write tools.

## Capability Manifest

Add one authoritative section to the Agent system prompt:

- The product accepts `.txt`, `.md`, and `.docx` document attachments up to the
  existing parser limit.
- DOCX files are parsed by the application before the content is sent to the
  Agent. The Agent should describe this as supported product behavior, not deny
  support because it does not personally read raw binary bytes.
- Visible JSON text in a supported document can be read and analyzed.
- DOCX headings, lists, tables, links, and eligible embedded images are
  converted into the semantic representation provided to the Agent.
- Legacy `.doc` is unsupported and should be converted to `.docx` or text.
- Hidden Word custom XML, custom properties, and exact layout/style fidelity are
  not supported.

When asked about document support, the Agent must answer from this manifest and
must not infer capabilities from the currently exposed tool names.

## Call-Site Routing

| Producer | Intent | Reason |
| --- | --- | --- |
| Agent chat attachment | `analyze` | General questions should follow the user's prompt |
| Design-document upload page | `tables` | This entry point explicitly generates project tables |
| Project document `Export as tables` | `tables` | The selected command is unambiguous |
| Signed table-export reconstruction | `tables` | It continues the bound export operation |

The existing document export and design-upload bindings remain unchanged.
Only their message intent becomes explicit.

## Prompt Routing

Replace the broad "message starts with `[Design document]`" condition with
intent-aware rules:

1. Read the explicit document intent from the current attachment message.
2. For `analyze`, answer from the supplied content and honor the user's request.
3. If an `analyze` request explicitly asks to create or import project tables,
   enter the existing table workflow.
4. For `tables`, always use the existing structure discovery, field-type
   discovery, quality gate, planning, and write sequence.
5. Treat legacy `[Design document]` messages as table intent only for backward
   compatibility when they are the active message.

The capability manifest applies to ordinary messages as well as attachment
messages, fixing generic questions such as "Do you support DOCX?".

## Error Handling and Compatibility

- Empty parsed content continues to fail before sending a message.
- DOCX parse and image-upload failures retain their current UI behavior.
- An unknown or missing intent in a new-format message is treated as analysis,
  which is the non-writing fallback. Code-generated messages cannot omit intent
  because the TypeScript parameter is required.
- Legacy history remains readable and compact through dual-header parsing.
- No database migration or conversation backfill is required.
- Existing table exports retain their signed snapshot and authorization rules.

## Testing Strategy

### Unit Tests

- Require and serialize `analyze` and `tables` intents.
- Verify analysis messages include the document body and user instructions but
  omit unconditional table-generation directives.
- Verify analysis messages instruct the Agent to summarize when user
  instructions are empty.
- Verify table messages retain extraction mode, the quality gate, project
  structure discovery, and field-type discovery.
- Verify the capability manifest accurately states supported formats and
  limitations.
- Verify `parseDesignMessage` handles new and legacy headers without exposing
  document content in the visible chat bubble.
- Verify each producer passes the intended explicit mode.

### Integration and Regression Tests

- Upload a DOCX in chat and ask for its contents; assert the model receives the
  parsed body under analysis intent and no table workflow is encoded in the
  message.
- Ask whether JSON embedded as visible DOCX text is supported; assert the system
  prompt contains the authoritative capability answer.
- Run the dedicated design upload and assert the table workflow remains intact.
- Export a project document as tables and assert signed snapshot reconstruction
  uses table intent.
- Reload history containing both old and new attachment messages and verify the
  same compact file-chip display.

LLM wording is probabilistic, so tests enforce the deterministic inputs and
routing contract rather than exact prose. The structured intent removes the
current contradictory instruction, while the capability manifest supplies the
ground truth needed for correct product answers.

## Rollout

Ship the builder contract, all call-site updates, prompt changes, and tests in
one change. Making the intent required without updating every producer would
break compilation; changing the prompt without the message contract would
leave the current forced table behavior in place.
