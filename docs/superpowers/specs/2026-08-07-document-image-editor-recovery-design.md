# Document Image Editor Recovery Design

## Goal

Make pasted and inserted document images behave like native editable document content:

- externally copied images upload to permanent storage and insert through MDXEditor's native image path;
- users can continue typing immediately after an image;
- oversized images stay within the document viewport without enlarging small images;
- the toolbar does not appear late after collaboration binding;
- retrying an interrupted collaboration session gives immediate, visible feedback.

## Current Behavior and Root Causes

### Image insertion and editing

Mixed clipboard payloads are currently intercepted at the React frame boundary. After the asynchronous upload completes, the frame calls `MDXEditorMethods.insertMarkdown()` with an image Markdown string.

This bypasses MDXEditor's image insertion signal. `insertMarkdown()` imports nodes at the current selection and clears selection when the editor is no longer considered focused. It does not execute the image plugin's root wrapping and `selectEnd()` behavior. An image inserted at the end of a document can therefore become the only selectable node with no reliable caret position for continued typing.

The correct extension boundary is inside MDXEditor's Realm and Lexical composer. MDXEditor's own `insertImage$` signal creates the image node, wraps it when needed, and moves selection to a usable position.

### Image overflow

MDXEditor's image wrapper is `inline-block`, and an image without explicit dimensions renders at intrinsic size. Large screenshots can exceed the editor width and extend past the right edge.

The worktree already contains uncommitted document image CSS that constrains image blocks and images to `max-width: 100%` with automatic height. This design adopts that behavior and must preserve the existing modification rather than overwrite it.

### Toolbar delay

While collaboration is preparing, `DocumentEditor` renders a read-only pending editor with `showToolbar={false}`. After collaboration binds, it remounts a collaborative editor with the toolbar enabled. The content can therefore appear well before the toolbar.

The editor already supports rendering its toolbar while read-only. Editors and admins should receive the toolbar during the pending phase, with editing commands governed by the read-only state. Viewers continue to receive no toolbar.

### Retry feedback

A degraded collaboration session intentionally sets the editor to read-only to prevent edits that cannot be durably synchronized. The Retry button currently fires an unobserved promise and has no pending or failure presentation, so a slow or failed retry appears inert.

The fail-closed read-only policy remains unchanged. Retry gains a local pending state, disabled button, progress label, and explicit failure toast.

## Chosen Architecture

### Clipboard image Realm plugin

Create a focused Realm plugin alongside the existing collaboration and image-export plugins. The plugin publishes a composer child that:

1. registers a Lexical `PASTE_COMMAND` handler;
2. ignores read-only editors and clipboard payloads without image files;
3. extracts image files synchronously from mixed clipboard items;
4. prevents fallback HTML/text insertion when valid image files exist;
5. uploads files through the existing document `imageUploadHandler`;
6. publishes each successful permanent URL through `insertImage$` with the file name as alt text.

The handler is intended to cover mixed payloads that MDXEditor's built-in image command declines. Pure image payload behavior may remain with the built-in command as long as it still uses the same upload handler and native insertion path.

The React frame-level `onPasteCapture` handler and `insertMarkdown()` image serialization path are removed. Markdown remains the persisted output format through the existing image export visitor; it is not the insertion mechanism.

### Selection and interaction contract

After a successful paste:

- the image is a native MDXEditor image node;
- the editor retains or restores a usable selection after the inserted node;
- typing immediately after upload adds document text rather than replacing or merely selecting the image;
- image selection, deletion, and resize controls continue to work;
- collaboration remains live and accepts the resulting Lexical update through the normal Yjs binding.

### Responsive image contract

Document image blocks have `max-width: 100%`. Images use `max-width: 100%` and `height: auto`.

- Images wider than the document content area shrink to fit.
- Smaller images keep their natural width.
- Aspect ratio is preserved.
- Image controls remain reachable within the editor viewport.

No fixed viewport-relative width or forced upscaling is introduced.

### Pending toolbar contract

For admin and editor roles, every current-document editor mount includes the toolbar plugin, including the read-only pending collaboration mount. Viewer and historical preview mounts remain toolbar-free.

This avoids the blank-toolbar interval and keeps toolbar layout stable while collaboration transitions from pending to live.

### Retry interaction

`DocumentEditorSession` tracks a local retry-in-progress flag.

- Clicking Retry immediately changes the label to `Retrying...` and disables the button.
- The existing `collaboration.retry()` operation is awaited.
- A rejection is caught and shown through the existing error-toast utility.
- The button becomes available again after completion or failure.
- Successful session state transitions continue to come from the collaboration session; the UI does not falsely mark itself live.

## Error Handling

Each clipboard image upload remains independently isolated. Successful images insert in clipboard order; failed images are omitted and logged. If all uploads fail, no fallback external HTML image or temporary URL is inserted.

If collaboration becomes degraded, the editor remains read-only. Retry failure must be visible but must not discard pending changes or recreate the session without the collaboration layer's authorization rules.

## Testing

Unit tests will verify:

- the Realm plugin is registered through `addComposerChild$` and uses `insertImage$`;
- the frame no longer inserts pasted images through `insertMarkdown()`;
- pending editors show the toolbar for admin/editor roles but not viewers;
- Retry awaits the operation, disables itself, changes label, and reports rejection;
- responsive image selectors target MDXEditor's generated image wrapper and image elements.

Playwright coverage will use an oversized generated PNG in a mixed clipboard payload and prove:

- the inserted URL points to `library-media-files`;
- image width does not exceed the content-editable width;
- aspect ratio is preserved;
- text can be typed immediately after image insertion;
- no connection-interrupted banner appears as a result of the insertion;
- image and following text survive reload;
- image selection controls remain within the document viewport.

Existing table Markdown and toolbar image-picker tests remain part of the regression gate.

## Out of Scope

- Allowing edits while collaboration durability is degraded.
- Changing image storage buckets or URL formats.
- Adding image captions, alignment, galleries, or new resize semantics.
- Replacing MDXEditor or changing document collaboration architecture.
