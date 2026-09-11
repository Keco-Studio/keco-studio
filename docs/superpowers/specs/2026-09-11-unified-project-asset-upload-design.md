# Unified project asset upload design

## Goal

Make MCP uploads and the project Assets library share one media contract. The
contract supports the existing image formats plus video, audio, documents,
archives, JSON, and PSD, with canonical MIME names and per-family size limits.

## Supported formats

PNG, JPEG, GIF, WebP, SVG, MP4, MP3, M4A, WAV, OGG, PDF, DOC, DOCX, XLS,
XLSX, PPT, PPTX, TXT, CSV, ZIP, JSON, and PSD. `image/jpg` is normalized to
`image/jpeg`; `audio/x-m4a` is normalized to `audio/mp4`.

## Limits and validation

Images, JSON, TXT, and CSV are limited to 10 MiB; Office/PDF files to 25 MiB;
audio to 50 MiB; MP4, PSD, and ZIP to 100 MiB. MIME and extension must match.
Binary signatures are checked before registration. SVG is restricted to safe
static content through an XML element and attribute allowlist. OpenXML files must contain the package root for their declared
DOCX, XLSX, or PPTX type. Database constraints use the same MIME and size tiers
and validate existing rows when the migration runs. The current completion
implementation downloads the uploaded object for verification, so deployment
should enforce the configured Storage and Edge Function memory limits before
enabling the 100 MiB classes.

## Flow and state

`create_image_upload`, `prepare_image_uploads`, `complete_image_upload`, and
`complete_image_uploads` remain the 5 MiB image-only compatibility flow.
`prepare_project_asset_uploads` returns signed PUT targets for the complete
media contract, and `complete_project_game_asset_uploads` verifies and registers
them in `project_game_assets`. Registration is item-scoped, idempotent for
identical metadata, and returns `reused: true` on exact replay. Successful
manual uploads are `ready`; validation or registration failures do not create a
ready row and invalid objects are removed where possible.

Expanded project Assets use the private `project-assets` bucket. Authenticated
project members can read objects, while owners, admins, and editors can create
or remove objects under their own user path. The existing public
`library-media-files` bucket remains limited to the legacy 5 MiB image flow.
Registry rows record the source bucket so historical images and new private
Assets can be signed correctly.

## API and UI

The browser POST endpoint and MCP completion use the same canonical contract.
Browser uploads use a metadata preparation request, direct signed PUTs to
Storage, and a small completion request; asset bytes are never carried in a
multipart application request. Completion verifies one object at a time.
Assets aggregation exposes format, size, status, preview/download capability,
and type-specific metadata. Images are previewed, browser-playable audio/video
use media controls, and documents/archives/PSD expose download actions.

## Compatibility

Existing image-only callers continue to work. `complete_image_uploads` keeps
returning verified image objects without project registration; project asset
registration is explicit through `complete_project_game_asset_uploads`.
