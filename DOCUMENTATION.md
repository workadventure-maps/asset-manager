# Documentation — Assets Collection Manager

Full technical documentation. For a quick overview, see [README.md](README.md).

---

## Table of contents

1. [Architecture](#1-architecture)
2. [Installation & running](#2-installation--running)
3. [Data model](#3-data-model)
4. [Server API](#4-server-api)
5. [Index page](#5-index-page)
6. [Collections page](#6-collections-page)
7. [Add Assets page](#7-add-assets-page)
8. [Align page](#8-align-page)
9. [Scan pipeline](#9-scan-pipeline)
10. [Persistence & local storage](#10-persistence--local-storage)
11. [Conventions & colors](#11-conventions--colors)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Architecture

A **100% local** application: a minimal Python HTTP server (`http.server`) serves both
static files (HTML/CSS/JS, images) and a small JSON API. The front end is vanilla
JavaScript (no build step, no framework).

```
Browser  ──HTTP──►  server.py  ──►  files (dist/, validated/, assets_list.json)
   │  static pages (index.html, align.html, …)
   └─ fetch() ──► API routes (POST JSON)
```

Components:

- **`main.py`** — CLI entry point; orchestrates clean / scan / serve.
- **`server.py`** — `Handler` (subclass of `SimpleHTTPRequestHandler`): CORS, "pretty"
  GET routes, POST API routes, `allow_reuse_address` so it can restart without waiting.
- **`image_processor.py`** — scanning, direction/color detection, dates, 32px grid helpers.
- **`clean-images.py`** — image folder cleanup.
- **Front end** — `index.html`/`app.js`/`app.css` + standalone pages (`align.html`,
  `add_assets.html`, `collection_list.html`, `collisions.html`) sharing `topbar.css`.

---

## 2. Installation & running

```bash
python3 --version          # 3.9+ recommended
pip install pillow         # optional (color on scan + image processing)

python3 main.py --mode serve          # server only (http://localhost:8000)
python3 main.py --mode scan           # scan src/ → dist/ + JSON
python3 main.py --mode all            # clean + scan + serve
```

CLI options: `--mode {serve,scan,clean,clean-scan,all}`, `--src-dir`, `--dist-dir`,
`--unknow-dir`, `--model-dir`, `--host` (default `0.0.0.0`), `--port` (default `8000`).

**Golden rule**: a change in `server.py` / `image_processor.py` only takes effect after
**restarting the server**. A front-end change only needs a browser **hard refresh** (the
server sends no cache-busting headers, so CSS/JS stays cached until you force a reload).

---

## 3. Data model

The root `assets_list.json` is the **default collection** loaded by the Index.

```jsonc
{
  "collectionName": "Assets",        // collection title
  "tags": ["Furniture"],             // global collection tags
  "collection": [ /* assets */ ]
}
```

### Asset fields

| Field | Type | Description |
|-------|------|-------------|
| `imagePath` | string | Relative path served by the server (e.g. `dist/chair-front-1.png`) |
| `name` | string | Human-readable name (used by the Name filter) |
| `tags` | string[] | Asset tags |
| `direction` | string | `front`, `back`, `left`, `right`, `up`, `down`, `unknow` |
| `color` | string | Main color in hex (`#RRGGBB`) |
| `secondaryColor` | string | Secondary color (hex, optional) |
| `category` | string | Category (predefined list, see §11) |
| `dateAdded` | string | ISO 8601 date added (stamped on creation/scan) |
| `dateModified` | string | ISO 8601 last-modified date (empty if never modified) |

Notes:
- `dateAdded` is **backfilled** on load if missing, then persisted.
- `dateModified` is updated on every field edit (single or bulk).
- On re-scan, existing dates are **preserved** (merged with the previous JSON).

---

## 4. Server API

All responses are JSON. CORS is open (`*`). Usual error codes: `400` (invalid
input), `404` (not found), `409` (conflict), `500` (server error).

### GET routes (pages + listing)

| Route | Effect |
|-------|--------|
| `/` | `index.html` |
| `/collection-list`, `/collections` | `collection_list.html` |
| `/add-assets` | `add_assets.html` |
| `/align` | `align.html` |
| `/collisions` | `collisions.html` |
| `/list_collections` | JSON: `{ collections: [{ dir, collectionName, tags, count, thumb }] }` |

### POST routes (API)

| Route | Expected body | Effect |
|-------|---------------|--------|
| `/` | full collection object | Overwrites `assets_list.json` (Index save) |
| `/validate_selection` | `{ dir, items:[{imagePath,newFilename}], json }` | Creates `validated/<dir>/` (flat images + `assets_list.json`). **409** if the folder exists. Writes `imageBase` into the JSON. |
| `/use_as_default` | `{ dir }` | Copies a pack from `validated/<dir>` to the root `assets_list.json`, with paths rewritten as `validated/<dir>/<file>` |
| `/save_image` | `{ path, dataUrl }` | Writes a PNG (base64) to a project-relative path (used by Align) |
| `/append_asset` | `{ asset }` | Appends an asset entry to the root `assets_list.json` (Align duplication) |
| `/upload_files` | `multipart/form-data` (`files`) | Uploads images into `dist/` (Add Assets) |
| `/resize_to_grid_to_dir` | — | Processes `dist/` → `dist32/` (crop + pad to multiples of 32) |

**Security**: write routes validate the path (rejecting `..`, unexpected `/`/`\` and
absolute paths) to stay within the project tree.

---

## 5. Index page

Main page (`index.html` + `app.js` + `app.css`).

### Top bar
- Shared navigation (`topbar.css`).
- **Source switch** `Default` / `<loaded file>`: toggles between the root `assets_list.json`
  and a manually loaded JSON (kept in memory and **persisted** across refreshes).
- **Load JSON**: loads a file. If image paths are bare filenames (validated pack),
  prompts for a **base prefix** (prefilled from `imageBase` if present).
- **Check duplicates**: shows only duplicates (same name + direction + color),
  **grouped by set** with a header per group.
- **dist32** toggle + **Resize to 32px Grid** (normalization tools).

### Collection metadata
Compact bar: **collection name** + **global tags**.

### Filters
- **Name** (on the `name` field only), **Tags** (with a **No tags** option at the top of the
  list), **Direction**, **Color** (with a **No color** option at the top, colors **sorted by
  hue**). All can be combined.

### Asset cards
- Full-width image (checkerboard background for transparency), name, tags, direction, color,
  secondary color, category, and **dates** (added / modified).
- In-place editing: every change updates the counters and saves (**debounced** server push)
  without rebuilding the grid.

### Action bar (selection)
- **Select / Deselect All**, **Bulk Edit** (bulk editing via a modal),
  **Validate Selection**, **Delete** (removes from the JSON, keeps the files).

### Validate Selection
Asks for a folder name → creates `validated/<name>/` (images + JSON). **Refuses** if the
folder already exists and asks for another name.

---

## 6. Collections page

`collection_list.html` — lists the packs in `validated/` via `/list_collections`.

Each card: thumbnail, collection name, folder, image count, tags, and a
**Use as default** button (`/use_as_default`) that sets this pack as the root collection.

---

## 7. Add Assets page

`add_assets.html` — import workflow:
1. **Drag & drop** images or a folder (or use the file pickers).
2. **Upload** to `dist/` (`/upload_files`).
3. **Generate JSON**: produces a downloadable JSON in the standard schema (with `dateAdded`).

---

## 8. Align page

`align.html` — realigns images that have transparent margins.

### Sources
- Left column: **collection picker** (`Default` / `Loaded` switch, search) +
  **file loading** (drag & drop).

### Editing (right column)
- **Trimming** of transparent edges (automatic, computes the opaque bounding box).
- **Drag** the image inside the frame + **3×3 alignment grid** (snap to an edge / center).
- Options: *Keep content inside frame*, *Show 32px grid* (on by default).
- **Mirror**: *Flip H* / *Flip V* (applied to the preview and to all outputs).

### Saving
- **Download**: aligned PNG saved locally.
- **Save now**: overwrites the original file (`/save_image`).
- **Add to batch** + **Save all**: a queue to process several assets and then save
  them all at once. Switching images with unsaved changes offers
  *Add to batch / Discard / Cancel*.
- **Save as copy**: duplicates into a new file + adds a JSON entry
  (`/append_asset` for the Default source, local cache for the Loaded source). A horizontal
  flip swaps the `left`↔`right` direction.

The frame keeps its **original size**: aligning "left" snaps the visible content to the
left edge without changing the dimensions (useful for grid-based sprites).

---

## 9. Scan pipeline

`image_processor.process_images(model_dir, src_dir, dist_dir, unknow_dir)`:

1. Walks `src/`. For each image:
   - **Direction** inferred from the filename (`front`/`back`/`left`/`right`/`up`/`down`), otherwise → `unknow/`.
   - **Color**: family found in the filename, otherwise estimated from the average color (Pillow),
     otherwise `grey`.
   - Renamed to `name-color-direction-index.png` → copied to `dist/`.
2. Re-scans `dist/` to rebuild the collection (filename parsing).
3. **Preserves existing dates** (merged with the previous `assets_list.json`).
4. Writes `assets_list.json`.

Grid helpers: `trim_transparent_borders`, `pad_to_multiple_of_32_center_x_align_bottom`,
`process_directory_to_grid` (used by `/resize_to_grid_to_dir`).

---

## 10. Persistence & local storage

- **Server**: `assets_list.json` (default collection), `validated/<name>/` (packs).
- **Browser (localStorage)** for the Index:
  - `assetmgr:source` — active source (`file` | `upload`).
  - `assetmgr:uploadCache` — last loaded JSON (with resolved paths) for instant switching
    and persistence across refreshes.

---

## 11. Conventions & colors

### Directions
`front`, `back`, `left`, `right`, `up`, `down`, `unknow`.

### Color families
Defined identically in Python and JS (`COLOR_FAMILIES`): red, maroon, crimson, coral,
blue, navy, teal, cyan, light_blue, yellow, gold, green, lime, forest_green, olive, brown,
chocolate, saddlebrown, orange, purple, magenta, fuchsia, pink, hot_pink, grey, dark_grey,
light_grey, black, white, beige, tan. A hex color's family is determined by Euclidean RGB
distance; the dropdown is **sorted by hue**.

### Categories
Predefined list: Architecture & Buildings, Furniture & Decoration, Equipment & Objects,
Nature & Landscape, Infrastructure & Outdoor, Characters & Avatars, Vehicles & Transport,
Signage & UI, Interactive Elements, Lighting & VFX, Sound & Music, Special / Thematic.

### Default tags
Furniture, Bathroom, Kitchen, Electronics, Bedroom, Office, Plants, Food & Drink, Decoration,
Transportation, Storage, Walls & Doors, Signage, Lighting, Meeting & School, Outdoor,
Recreation & Gaming.

---

## 12. Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| A `.py` change has no effect | Restart the server (`Ctrl+C`, then relaunch). |
| A CSS/JS change doesn't show up | Hard refresh the browser (`Cmd/Ctrl + Shift + R`). |
| `Address already in use` | A server is already running on that port; stop it, or change `--port`. |
| Validate writes into `validate elements` | Stale server still running → restart it. |
| Pack images return 404 after *Load JSON* | Enter the correct base path prefix (e.g. `validated/<name>`) when loading. |
| Missing color (`No color`) after a scan | The scan always assigns at least `grey`; color-less assets mostly come from Add Assets. |
| No color estimation during scan | Install Pillow (`pip install pillow`). |
