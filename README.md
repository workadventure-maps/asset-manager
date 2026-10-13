# Assets Collection Manager

A local web tool to **organize, edit and prepare graphic assets** (PNG sprites).
It scans images, assigns them metadata (name, direction, color, tags, category, dates),
lets you filter/edit the collection through a web UI, **realign** images, build
**validated packs**, and switch the default collection.

> 📖 Detailed documentation: see **[DOCUMENTATION.md](DOCUMENTATION.md)**.

---

## 🚀 Quick start

```bash
# 1. (optional) scan images from src/ into dist/ and generate assets_list.json
python3 main.py --mode scan

# 2. start the web server (serves the pages + the API)
python3 main.py --mode serve
```

Then open **http://localhost:8000** in your browser.

> ⚠️ Any change to a `.py` file requires **restarting the server**
> (`Ctrl+C`, then relaunch). Changes to pages/JS/CSS only need a hard browser
> refresh (`Cmd/Ctrl + Shift + R`; the server sends no cache-busting headers).

Optional dependency: **Pillow** (`pip install pillow`) for color estimation during scans
and image processing. Everything else works without external dependencies.

---

## 📂 Project layout

```
.
├── main.py               # CLI orchestrator (clean / scan / serve / …)
├── server.py             # HTTP server + JSON API ("pretty" pages + POST routes)
├── image_processor.py    # Scan src/ → dist/, color, dates, 32px normalization
├── clean-images.py       # Image folder cleanup
│
├── index.html            # Main page: collection (filters, editing, validate, delete…)
├── add_assets.html       # Image import + JSON generation
├── align.html            # Image realignment / cropping / mirroring / duplication
├── collection_list.html  # List of validated/ packs + "Use as default"
├── collisions.html       # Collisions tool (existing)
│
├── app.js                # Index logic
├── app.css               # Index styles
├── topbar.css            # Shared navigation bar (all pages)
├── collisions.css / .js  # Collisions page
│
├── assets_list.json      # Collection database (root = default collection)
├── src/                  # Source images to process (scan input)
├── dist/                 # Organized images (scan output, served by the server)
├── dist32/               # Versions normalized to a 32px grid (optional)
├── unknow/               # Images with no detected direction
└── validated/            # Validated packs: validated/<name>/ (images + assets_list.json)
```

---

## 🧭 Pages

| Page | URL | Purpose |
|------|-----|---------|
| **Index** | `/` | Browse, filter and edit the collection; validate a selection; delete; duplicates |
| **Collections** | `/collection-list` | List the packs in `validated/`, set one as default |
| **Add Assets** | `/add-assets` | Import images into `dist/` and generate a JSON |
| **Align** | `/align` | Crop, align, mirror and duplicate images |
| **Collisions** | `/collisions` | Collisions tool |

---

## 🗃️ Asset schema (`assets_list.json`)

```json
{
  "collectionName": "Assets",
  "tags": ["Furniture", "Outdoor"],
  "collection": [
    {
      "imagePath": "dist/chair-brown-front-1.png",
      "name": "chair",
      "tags": ["Furniture"],
      "direction": "front",
      "color": "#A52A2A",
      "secondaryColor": "",
      "category": "Furniture & Decoration",
      "dateAdded": "2026-06-23T14:00:00Z",
      "dateModified": ""
    }
  ]
}
```

---

## 🔁 Typical workflows

- **Build a pack**: Index → filter/edit → select → **Validate Selection** →
  creates `validated/<name>/` (images + JSON). See the list in **Collections**.
- **Change the default collection**: **Collections** → **Use as default** (rewrites the
  root `assets_list.json`).
- **Fix transparent margins**: **Align** → pick the asset → align / crop /
  mirror → **Save now**, or **Add to batch** then **Save all**.
- **Duplicate a sprite as a mirror image**: **Align** → Flip H → **Save as copy** (new file +
  JSON entry, `left`/`right` direction swapped automatically).

---

## 🛠️ `main.py` CLI

| Mode | Effect |
|------|--------|
| `--mode serve` | Start the web server only (default) |
| `--mode scan` | Scan `src/` → `dist/` and update `assets_list.json` |
| `--mode clean` | Run `clean-images.py` |
| `--mode clean-scan` | Clean, then scan |
| `--mode all` | Clean + scan + serve |

Options: `--src-dir`, `--dist-dir`, `--unknow-dir`, `--model-dir`, `--host`, `--port`.

---

For details on API routes, filters, formats and behaviors,
see **[DOCUMENTATION.md](DOCUMENTATION.md)**.
