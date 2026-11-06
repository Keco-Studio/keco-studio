# Script syntax and document conversion

Authors normally use Dialogue and Flow Chart. Source Document remains available
from the sidebar; Preview plays the current Shot Script animation.

## Text syntax

Use ASCII syntax delimiters. Preserve the original language and punctuation in
story content. Do not wrap dialogue in quotation marks.

```text
**Character - Keeper**
*Older man wearing a navy raincoat and carrying a copper lamp.*

**Character - Visitor**
*Young woman with short dark hair, a brown coat and a canvas bag.*

**Act One - The Lighthouse**
*Evening. Sea wind shakes the curtains.*
Keeper: Where should we look first?
O1: Check the sea (jump O1)
O2: Read the letter (jump O2)
O1 branch [O1 | Sea]
Visitor: Three lights are flashing offshore.
Keeper: That is a distress signal.
O2 branch [O2 | Letter]
Visitor: A ship is arriving tonight.
Keeper: We should light the beacon.
```

- Whole-line `**Title**` is a title, even if it contains a colon.
- Whole-line `*Description*` is narration, action or environment, even if it
  contains a colon. Avoid ambiguous unmarked scene labels.
- `Speaker: Text` is dialogue. Legacy quoted dialogue remains accepted input;
  normalized output has no surrounding quotation marks.
- `**Character - Name**` introduces author metadata. Consecutive italic lines
  describe that character and never become playable dialogue or narration.
  A new heading, dialogue, or explicit scene annotation ends the profile.
  Put profiles before the story title to make that boundary unambiguous.
- `O1: Choice (jump O1)` declares an option and its target.
- `O1 branch [O1 | Description]` declares a branch. Descriptions cannot contain
  square brackets or vertical bars. Preserve all options, including more than three.
- `(Jump Oend)` jumps to `Oend merge [Oend | Description]`. Add a shared
  continuation only when it exists in the source. Independent endings do not
  require a merge or invented closing dialogue.
- Explicit variable effects can be retained as
  `O1: Choice ($trust+=1; jump O1)`. Never infer effects from prose.
- Labels start with an ASCII letter and contain up to 64 letters, digits,
  underscores or hyphens. Every jump must refer to a declared label.

## Conversion contract

The model returns Script text, not a replacement JSON authoring language. The
application parses that text into its existing internal table and graph models.
It checks text coverage, speaker ownership, repeated dialogue, character
descriptions, variable effects and branch references. Invalid output receives
one repair attempt. Unvalidated fallback content is not persisted as a successful
import. Empty input, cancellation and provider failure cannot silently succeed.

The converter understands explicit natural-language reporting cues, profile
blocks, scene annotations and choice lists. It preserves story content and does
not invent branches for a linear story. Unknown speakers remain narration.
Supported file decoding is determined by the existing import entry point;
conversion does not add OCR or arbitrary binary file support.

When importing an existing document, the server verifies the source snapshot,
saves a version and updates Source Document to the normalized Script. A concurrent
source edit rejects the update. Failed source synchronization removes the newly
created library rather than leaving a disconnected result.

## Visual editing and preview

Dialogue edits synchronize to source blocks. Flow Chart retains its editable
nodes, pins and curved connections. Character extraction reads the authoritative
source and actual speakers. Explicit author descriptions take precedence over
model summaries; missing biographical or visual traits are not invented.
Non-English profiles are translated only for the image-generation prompt; the
author's profile remains in its original language.

Shot Script controls durations, camera movement, effects and branch targets.
Preview uses the same mounted board, available artwork and draft backgrounds.
Restart resets playback; Edit Shot Script returns to the current draft.

Character cards and references use the existing browser-local storage. Saved shot
templates are also browser-local. Source and dialogue persistence does not imply
cross-device storage of shot artwork. Character sprites provide costume
continuity, not per-action character animation.
