# Changelog

All notable changes to this project will be documented in this file.

---

## [Unreleased]

### Added
- **Sprite Editor — pixel-precise recrop step** (`align.html`)
  - Recrop tab now has a **32 px / 1 px** toggle switch. In 1 px mode, each +/− button moves one pixel; in 32 px mode the existing 32 px grid behaviour is preserved.
  - Auto-trim in 1 px mode trims exactly to the content bounding box (no 32 px snap).
  - Minimum crop guard adapts: 32 px mode prevents going below 32 px; 1 px mode prevents going below 1 px.

- **Sprite Editor — Add to batch in Recrop tab** (`align.html`)
  - "Add to batch" button added to the Recrop panel. Queues the combined align + recrop output just like the Align panel button.

- **Sprite Editor — renamed from Align** (`align.html`, all nav pages)
  - Page title changed to "Sprite Editor". Nav label updated from "Align" to "Sprite" across all pages. URL `/align` unchanged.

### Fixed
- **Sprite Editor — canvas proportion bug** (`align.html`)
  - The canvas was distorted after switching between Align and Recrop modes because `renderRecrop` set `view.style.width/height` but `renderAlign` never reset them. Fixed by always setting both the pixel dimensions and the CSS size in a single unified `render()` function.

- **Align + Recrop — unified pipeline** (`align.html`)
  - Align and Recrop now share a single `buildOutput()` and `render()` pipeline: the content is aligned first (dx/dy offset, flip, trim), then recrop pads are applied on top of the result. You can align in one tab and recrop in the other without saving in between — all save and download actions always produce the combined result.
  - When recrop pads are non-zero, the original frame boundary is shown as a dashed overlay in both modes so the alignment reference remains visible.

- **Recrop — integrated into Align page** (`align.html`)
  - The Align page now has two tabs in the right panel: **Align** and **Recrop**. Switching tabs changes the canvas rendering and the available controls; the asset picker and file drop are shared.
  - Recrop mode: crop/expand in multiples of **32 px** from any edge (Top / Right / Bottom / Left) using +/− step buttons.
  - Live canvas preview with optional 32 px grid overlay and color-coded change zones (blue = expanded, red = cropped).
  - Dimensions badge shows in real time whether the output dimensions are a multiple of 32.
  - **Auto-trim** button: scans transparent border pixels, trims them, then snaps to the next 32 px boundary (content centered).
  - **Download** exports the cropped result as a PNG. **Save to server** overwrites the original file via `/save_image`.
  - Dragging the canvas is disabled in Recrop mode to avoid conflicts with the pad controls.

- **Elegant dialogs — replaced all native `alert` / `confirm` / `prompt`** (`dialog.js`, `app.js`, `align.html`, `collection_list.html`)
  - New `dialog.js` shared utility exposes `Dialog.alert()`, `Dialog.confirm()`, `Dialog.prompt()` — all return Promises and animate in/out with a blurred backdrop.
  - Supports `type` variants (`info`, `success`, `warning`, `error`) with matching icons, and a `danger` flag for destructive confirm buttons.
  - All native blocking calls replaced across `app.js` (bulk edit, delete, validate, load JSON), `align.html` (save, batch save/discard, duplicate) and `collection_list.html` (use as default).

- **Collection List — scan all JSON files + `collection_thumbnail` support** (`server.py`, `collection_list.html`)
  - `list_collections` now uses `rglob("*.json")` and includes any JSON file whose root contains a `collection` array, not just `assets_list.json`.
  - A `collection_thumbnail.jpg/jpeg/png/webp` file in the collection folder is used as the card thumbnail in priority over the first asset image.
  - The card subtitle now shows the actual JSON filename (via the new `jsonFile` field) instead of always showing `assets_list.json`.

- **Collection List — server error feedback** (`collection_list.html`)
  - When `server.py` is not running, the page now shows a clear warning instead of silently showing no collections.
  - If the default card loads but the server is unreachable, an inline warning banner explains that `validated/` collections require `server.py` on port 8000.

- **Collection List — default collection card** (`collection_list.html`)
  - The page now fetches `assets_list.json` directly (in parallel with `GET /list_collections`) and renders it as the first card, visually distinguished with an accent border and a `default` badge.
  - The default card links directly to `/` (Index) instead of offering a "Use as default" action.
  - If the server is unreachable, the default card still loads since it reads the static `assets_list.json` file directly.

- **Collection List — UI overhaul** (`collection_list.html`)
  - Thumbnail now fills the full card width (aspect ratio 4/3) instead of a small 64px square.
  - Active collection (currently loaded in the Index) is highlighted in green with an `active` badge.
  - Removed the "Index" button from validated collection cards.
  - "Use as default" now redirects directly to `/` after a successful save instead of showing an alert.

- **`use_as_default` — support for nested dirs and custom JSON filenames** (`server.py`, `collection_list.html`)
  - The endpoint no longer rejects `dir` values containing `/` (e.g. `sub/pack`), allowing collections from nested subdirectories to be set as default.
  - A `jsonFile` field is now accepted in the request body so any JSON file (not just `assets_list.json`) can be promoted as default.
  - Path traversal protection updated to check for `..` in any segment rather than blanket-rejecting slashes.

- **Collection dropdown — lazy loading to avoid startup timeout** (`app.js`)
  - `loadCollectionsList` is no longer called eagerly on page init. It now fires only on the first `focus` or `mousedown` on the select, preventing a `ERR_CONNECTION_TIMED_OUT` console error when the server is slow to respond or not yet running.
  - Added a 4-second `AbortSignal.timeout` so a slow server fails quickly and silently instead of hanging.
  - The list is fetched at most once per page load (`_collectionsLoaded` flag).

### Changed
- **Clean URL routing — removed `.html` extensions from all navigation links** (`index.html`, `collection_list.html`, `add_assets.html`, `align.html`, `collisions.html`, `server.py`)
  - All `<nav>` links updated to use clean routes: `/`, `/collections`, `/add-assets`, `/align`, `/collisions`.
  - `server.py` now explicitly maps `/` and `/index` → `index.html` in addition to the existing route aliases.

- **Index — Collection source switcher replaced by a dropdown** (`app.js`, `topbar.css`)
  - The segmented Default / filename toggle in the topbar is replaced by a `<select>` element.
  - On load, the dropdown is populated from `GET /list_collections`, listing every pack present in `validated/`.
  - Selecting a collection directly loads its `assets_list.json` and rewrites image paths using the stored `imageBase` field — no file-upload prompt needed.
  - The "Load JSON" button remains available for loading arbitrary local JSON files.
  - A new `source.type = 'collection'` prevents `applyExternalJSON` from overwriting the active source when a collection is selected from the dropdown.
  - Added `.menu-select` styles in `topbar.css` (pill shape, custom SVG arrow, focus ring).
