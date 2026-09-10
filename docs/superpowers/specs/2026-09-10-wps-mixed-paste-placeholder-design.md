# WPS Mixed Paste Placeholder Design

## Problem

WPS mixed text-and-image clipboard payloads can expose image positions as local
temporary URLs such as
`file:///C:/Users/.../Temp/ksohtml/wps_clip_image-123.png`. A browser page
cannot read those files. On Windows, Chromium may additionally expose readable
image files or `text/rtf` containing embedded PNG or JPEG bytes. The current
document paste preparation does not inspect RTF and removes inaccessible image
elements, so users see the surrounding text but no image or indication that an
image was lost.

## Desired Behavior

- Preserve the rich text and its formatting.
- Upload and insert images normally when WPS supplies readable clipboard image
  files.
- If no matching files exist, recover embedded PNG and JPEG images from an
  exposed WPS `text/rtf` payload and upload them in HTML image order.
- When a WPS image has only an inaccessible local temporary URL, replace it at
  the same document position with this visible paragraph:
  `[WPS image was not included in the clipboard. Paste this image separately.]`
- Show one warning toast per paste operation when one or more WPS images use
  the fallback.
- Never fetch a local `file:` URL or an arbitrary remote URL.
- Keep sanctioned document validation and collaboration persistence valid at
  every intermediate state.

## Detection and Data Flow

`extractClipboardRtfImageFiles` will parse balanced RTF `pict` groups, accept
embedded `pngblip` and `jpegblip` hexadecimal payloads, reject malformed or
unsupported payloads, and remove duplicate compatibility copies while
preserving order.

`prepareClipboardRichImagePaste` will resolve each HTML image by priority:
matching clipboard image file, embedded RTF image by order, then an embedded
HTML data image. It will distinguish unresolved WPS temporary image sources
from other unsupported sources. Each unresolved WPS image will be replaced
with a text marker while preserving DOM order. The return value will include
the number of WPS image fallbacks.

The paste plugin will synchronously insert the prepared rich HTML. If the
fallback count is nonzero, it will call the existing shared toast utility once
with warning styling. Uploadable data images and clipboard files will continue
through the existing placeholder, upload, and Lexical node-key replacement
flow.

Unsupported non-WPS image sources will retain the current safe behavior: no
local or authenticated fetch is attempted, and invalid image nodes are not
persisted.

## Error Handling

- A WPS local image without bytes produces the inline marker and warning.
- A supplied clipboard image file takes precedence over RTF and the WPS local
  URL.
- Malformed, duplicate, or unsupported RTF image groups are ignored safely.
- An upload failure removes only its temporary image node; WPS fallback markers
  inserted for other images remain.
- Multiple missing WPS images produce multiple position-preserving markers but
  only one toast.

## Testing

- Unit tests will reproduce WPS `ksohtml` and `wps_clip_image` URLs and assert
  that markers preserve image positions and the fallback count is accurate.
- Unit tests will exercise WPS-style RTF with PNG and JPEG `pict` groups,
  duplicate compatibility groups, and malformed data.
- Unit tests will verify that RTF image bytes are mapped to WPS HTML images in
  order and sent through the upload handler.
- Unit tests will verify that a matching clipboard file still uploads normally
  and does not create a fallback marker.
- Plugin wiring tests will verify that the warning toast is emitted once when
  the fallback count is nonzero.
- A Chromium regression will paste WPS-style mixed HTML, verify formatted text
  and the inline marker, verify the warning toast, and verify persistence after
  reload.
- Existing HTML data-image, clipboard-file image, table paste, full unit, build,
  English-character, and migration gates remain required.

## Non-Goals

- Reading WPS temporary files from `file:` URLs.
- Reading proprietary native clipboard formats that Chromium does not expose.
- Decoding RTF vector formats such as Windows Metafile.
- Fetching remote images with the user's browser credentials.
