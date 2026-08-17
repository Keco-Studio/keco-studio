# Game Design System Human Document Design

## Goal

Make generated Game Design Systems readable like Open Design while keeping
structured rules as the authoritative execution contract for Keco Agent.

## Problem

The current generation path returns a validated `GameDesignRuleSet`. This is
stable for agent policy injection, version diffs, and rule editing, but the
primary user experience is a list of rules rather than a coherent design
document. Open Design presents a human-readable design document first and
keeps compiled tokens and component metadata as supporting execution layers.

## Design

Generation returns one validated structured payload with two semantic layers:

```ts
type GameDesignDocument = {
  designIntent: string;
  playerFantasy: string;
  coreLoop: string;
  decisionStructure: string;
  systemBoundaries: string;
  progressionEconomy: string;
  contentModel: string;
  difficultyBalance: string;
  experiencePresentation: string;
};

type GeneratedGameDesignSystem = {
  schemaVersion: 1;
  document: GameDesignDocument;
  rules: GameDesignRuleSet;
};
```

The model still returns JSON only. It does not author the final Markdown
directly. The server validates both the document fields and rules, then
deterministically renders `GAME_DESIGN_SYSTEM.md` from the validated document
and rules. The structured rules remain the source of truth for Agent policy;
the rendered Markdown is the human-readable projection.

## User Experience

The selected-system workspace opens on `Overview` / `Design Document`.

- Overview renders the generated document with its design intent, player
  fantasy, loops, decisions, boundaries, progression, balance, and
  presentation sections.
- Rules remains the structured editor for rule IDs, kinds, statements,
  severity, applicability, rationale, and evidence.
- Versions shows document and rule changes together.
- Sources and Projects keep their current behavior.
- Editing document fields or rules is local until the user reviews changes and
  creates a new immutable version.

The UI must never show raw JSON as the primary generated result. A compact
Markdown view or export may be available as a secondary representation.

## Data Flow

```text
Foundation + Sources
  -> resolved server-authorized input
  -> DeepSeek structured JSON (document + rules)
  -> Zod validation and size limits
  -> deterministic Markdown rendering
  -> immutable version with document, rules, Markdown, sources, diff, hash
  -> pinned project binding
  -> Agent receives sanitized rules; user reads Overview document
```

The generation job, idempotency, retry, source redaction, and project version
pinning semantics remain unchanged.

## Compatibility

- Existing versions without a document use a deterministic compatibility
  document derived from their current rules and metadata.
- Legacy Markdown migration remains supported through the existing legacy rule
  conversion path.
- Rules-only API consumers continue to receive `rules` unchanged.
- `rendered_markdown` stays available and is upgraded to include the document
  sections before the rule sections.

## Validation and Failure Handling

- Document fields are bounded, non-empty strings with a total size limit.
- The generated payload must contain both `document` and `rules`.
- Invalid JSON or schema output receives one repair attempt, as today.
- A second invalid response fails the durable generation job and saves no
  partial system.
- Document content is treated as untrusted design data when inserted into the
  Agent prompt; it cannot alter tool, authorization, or system-priority rules.

## Testing

- Unit-test document schema parsing and deterministic Markdown rendering.
- Extend generation tests to assert the prompt requires document plus rules,
  accepts valid output, repairs invalid output, and rejects invalid document
  fields.
- Extend service/version tests to assert document persistence, compatibility
  fallback, content hashes, and immutable version creation.
- Extend page tests to assert Overview is the default view, document content is
  readable, and Rules editing still creates a new version.
- Extend Playwright coverage to verify the generated document appears before
  the Rules editor and remains usable on mobile.
