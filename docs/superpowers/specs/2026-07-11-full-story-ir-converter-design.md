# Full Story IR Converter Design

## Goal

Import arbitrary story prose without requiring labels, branch keywords, Markdown conventions, or a standard script format. The Converter LLM identifies all visible content and creates the complete story graph. The server validates evidence and behavior, the Auditor LLM independently reviews the result, and deterministic code compiles the accepted Story IR into the reference-compatible Library table.

## Authority Boundary

The Converter may:

- classify background, scene text, narration, system text, and dialogue;
- identify speakers and visible content;
- create stable node IDs;
- identify any number of choices;
- create nested branches, jumps, merges, loops, and terminal paths;
- assign exact source commands to nodes or choices.

The server may not decide whether a source unit is a choice before the Converter runs. Regex segmentation is evidence extraction only, not semantic authority.

The server must reject a candidate when:

- visible node or option content cannot be traced to declared source units;
- a declared source unit does not exist;
- a source unit is omitted or assigned as visible content more than once;
- a command is missing, duplicated, changed, or owned by the wrong node or choice;
- entry, next, or choice targets are unresolved;
- a node is unreachable;
- a choice node also falls through automatically;
- automatic transitions form a cycle;
- compiled rows or enumerated paths do not match the Story IR.

The Auditor receives the original source units, extracted Story IR, compiled table, and enumerated paths. Database writes require an Auditor pass with no major or critical issues.

## Converter Contract

The Converter returns one strict JSON object:

```json
{
  "version": 3,
  "entryNodeId": "start",
  "structuralUnitIds": ["source:4"],
  "nodes": [
    {
      "id": "start",
      "type": "dialogue",
      "speaker": "七号",
      "content": "我们必须选择一条路线。",
      "sourceUnitIds": ["source:3"],
      "commandSources": [],
      "nextNodeId": "",
      "choices": [
        {
          "text": "前往能源舱",
          "targetNodeId": "energy",
          "sourceUnitIds": ["source:5"],
          "commandSources": ["$resolve+=1"]
        }
      ]
    }
  ]
}
```

Visible text must be copied from the source without paraphrasing. The Converter may remove only speaker cues, matching quote wrappers, list markers, structural choice phrases, labels, jump metadata, and command metadata. Each non-empty source unit must be assigned exactly once to a node, an option, or `structuralUnitIds`.

`structuralUnitIds` is limited to source units that contain only formatting, branch instructions, jump instructions, merge markers, or other non-visible control language. The Auditor rejects visible story content hidden as structural metadata.

## Server Materialization

The server derives full `SourceRef` values from source unit IDs. It parses numeric commands from the original source, matches exact normalized command sources, and reconstructs canonical `StoryCommand` objects. LLM-provided command numbers are never trusted.

Traceability comparison normalizes whitespace, matched quote wrappers, Markdown list markers, and common structural punctuation, but does not permit paraphrasing or synonym substitution.

The server converts the accepted extraction to the existing `StoryDocument` type, then reuses deterministic table compilation, playback, variable execution, and Excel export.

## Retry And Failure

Each import has at most two Converter/Auditor attempts and four total LLM calls. Deterministic issues and Auditor issues are passed to the next Converter attempt. Failure writes no Library data and returns specific issue codes and source unit IDs.

Provider wrapper objects, prose around JSON, unknown fields, missing required fields, and malformed graph targets remain rejected.

## Compatibility

All story text, including old explicit formats, uses the same full Converter and Auditor path. Old labels and jump hints are included in the source evidence and may guide the LLM, but they do not switch to a different semantic pipeline.

The fixed 17-column compiler, extension-column rules, player, variable runtime, and story Excel writer remain unchanged.

## Verification

Automated tests cover:

- arbitrary prose choices without standard branch syntax;
- Markdown list choices;
- dialogue, narration, background, and stage directions;
- nested choices and four terminal paths;
- branch merges and independent endings;
- exact command ownership and values;
- omitted, duplicated, invented, or paraphrased content;
- invalid source unit references;
- unreachable nodes and branch leakage;
- Auditor retry and fail-closed behavior;
- legacy explicit input through the same full extraction pipeline.

Live tests generate multiple random Chinese stories with different wording and formatting. Each test requires an Auditor pass, the expected number of choices and paths, correct variable outcomes, no sibling leakage, and a valid reference-format table.
