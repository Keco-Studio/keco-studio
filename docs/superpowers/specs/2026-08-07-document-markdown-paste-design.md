# Document Markdown Paste Design

## Goal

Make tables and external images paste predictably into the document editor:

- Copied library tables remain editable GFM Markdown tables in the document model.
- External clipboard images are uploaded before insertion, then stored in Markdown by permanent public URL.
- Plain text and other clipboard content continue through MDXEditor's existing paste behavior.

## Current Behavior and Root Cause

MDXEditor already receives the document image upload handler used by the toolbar image picker. The handler uploads files to the public `library-media-files` bucket and returns a public URL.

MDXEditor's built-in image paste command only handles a clipboard payload when every item is an image. Browsers commonly provide a copied web image as a mixed payload containing `image/*`, `text/html`, and `text/plain`. The built-in command rejects that payload, so no upload or image insertion occurs.

Library table copy already writes a rich clipboard item containing an HTML table. MDXEditor's table plugin imports that representation as a native table and its document serializer emits GFM Markdown. The current end-to-end test proves the native editable table behavior, but it does not explicitly assert the persisted Markdown representation.

## Chosen Approach

Add a focused image paste adapter at the editor boundary. It will inspect clipboard data and handle clipboard image files even when text or HTML representations are present.

This is preferred over relying on MDXEditor's built-in behavior because the built-in image logic rejects common mixed clipboard payloads. It is preferred over replacing or patching the dependency because a local adapter is testable, upgrade-safe, and limited to Keco's document contract. Existing table import is retained because it already creates the required native GFM-backed table.

## Clipboard Routing

The adapter applies the following routing:

1. If one or more image files are present, handle the image files and do not insert fallback HTML or text for those images.
2. Otherwise, return control to MDXEditor's default paste handling, including its existing native table import.

The adapter runs only for editable documents. Read-only and historical document views do not upload or insert content.

## Image Paste

For each clipboard item whose MIME type starts with `image/`:

1. Read a non-null `File` from the clipboard item.
2. Upload it through the existing `imageUploadHandler`.
3. The handler stores the object in the `library-media-files` bucket at:

   ```text
   {userId}/{timestamp}-{sanitizedFileName}
   ```

4. Use the returned public URL to insert an editor image node at the current selection.
5. The document's canonical Markdown serializes the node as:

   ```markdown
   ![fileName](publicUrl)
   ```

No Base64 or blob URL is persisted. Existing remote URLs from the clipboard's HTML representation are not used as a substitute for upload when an image file is available.

Multiple image files preserve clipboard order. Invalid clipboard items are ignored. If no valid image file remains, default paste behavior is allowed.

## Table Paste

The existing table flow remains unchanged:

1. Library copy writes both TSV `text/plain` and an escaped HTML `<table>`.
2. MDXEditor consumes the HTML representation through its table plugin.
3. The document model contains a native editable table.
4. Document serialization emits the table as GFM Markdown with the first copied row as the header.

This task adds a persistence assertion to the existing end-to-end coverage so the GFM Markdown contract is explicit. It does not change spreadsheet-friendly TSV fallback behavior or project-table-to-project-table paste semantics.

## Failure Handling

Image upload failure must not insert a broken image, temporary URL, or the clipboard's fallback HTML. The failure is surfaced through the existing document error/toast pattern when available and logged with enough context for diagnosis. Successfully uploaded images from the same paste may still be inserted; failed entries are omitted.

## Testing

Unit coverage will verify:

- Mixed image, HTML, and text clipboard payloads still select the image upload route.
- Image files are uploaded and inserted using the returned URL.
- Plain text, tables, and HTML without image files are not intercepted.

Editor wiring coverage will verify that the adapter is registered only for editable document instances and uses the existing upload handler.

End-to-end coverage will paste a clipboard image into a live document, assert that the rendered image URL points at `library-media-files`, wait for the durable collaboration write, reload, and confirm the image remains. Existing library-table coverage will additionally verify the persisted GFM Markdown round-trip.

## Out of Scope

- Copying images out of the document.
- Copying image fields from library tables.
- Persisting Base64 image data in documents.
- Replacing the existing toolbar image picker or upload storage service.
