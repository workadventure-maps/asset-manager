# image_processor.py
from __future__ import annotations
import os
import re
import json
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Tuple, Iterable, Optional

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")

# --- Lazy model (placeholder / extensible) -----------------------------------
# If you want to enable CLIP later, only load it when scanning.
_model = None
_processor = None

def get_clip():
    """
    Load CLIP on demand (lazy). Currently unused in the base pipeline.
    You can enable it for recognition + advanced tagging if needed.
    """
    global _model, _processor
    if _model is None or _processor is None:
        print("Loading CLIP (lazy)…")
        from transformers import CLIPProcessor, CLIPModel  # late import
        _model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
        _processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
    return _model, _processor


# --- Colors (aligned with server.py) -----------------------------------------
COLOR_FAMILIES: Dict[str, str] = {
    "red": "#FF0000", "maroon": "#800000", "crimson": "#DC143C", "coral": "#FF7F50",
    "blue": "#0000FF", "navy": "#000080", "teal": "#008080", "cyan": "#00FFFF",
    "light_blue": "#ADD8E6", "yellow": "#FFFF00", "gold": "#FFD700", "green": "#00FF00",
    "lime": "#00FF00", "forest_green": "#228B22", "olive": "#808000", "brown": "#A52A2A",
    "chocolate": "#D2691E", "saddlebrown": "#8B4513", "orange": "#FFA500", "purple": "#800080",
    "magenta": "#FF00FF", "fuchsia": "#FF00FF", "pink": "#FFC0CB", "hot_pink": "#FF69B4",
    "grey": "#808080", "dark_grey": "#A9A9A9", "light_grey": "#D3D3D3", "black": "#000000",
    "white": "#FFFFFF", "beige": "#F5F5DC", "tan": "#D2B48C",
}
ALL_DIRECTIONS = {"front", "back", "left", "right", "up", "down", "unknow"}


# --- Misc utilities -----------------------------------------------------------
IMG_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}

def is_image(path: Path) -> bool:
    return path.suffix.lower() in IMG_EXTS and path.is_file()

def slugify(s: str) -> str:
    return (
        str(s or "")
        .strip()
        .lower()
        .replace(" ", "-")
        .replace("__", "_")
        .replace("--", "-")
    )

def hex_to_rgb(hex_code: str) -> Optional[Tuple[int, int, int]]:
    try:
        h = hex_code.lstrip("#")
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
    except Exception:
        return None

def closest_color_family_from_rgb(rgb: Tuple[int, int, int]) -> Tuple[str, str]:
    """Return the closest (family, hex) pair (Euclidean distance)."""
    r, g, b = rgb
    best_name, best_hex, best_d = "unknown", "#000000", float("inf")
    for name, hexv in COLOR_FAMILIES.items():
        rgb2 = hex_to_rgb(hexv)
        if not rgb2:
            continue
        dr = r - rgb2[0]
        dg = g - rgb2[1]
        db = b - rgb2[2]
        d = dr * dr + dg * dg + db * db
        if d < best_d:
            best_d = d
            best_name, best_hex = name, hexv
    return best_name, best_hex

def average_rgb(path: Path, sample_step: int = 8) -> Optional[Tuple[int, int, int]]:
    """
    Fast pixel average (subsampled) to estimate the dominant hue.
    """
    try:
        from PIL import Image
    except Exception:
        # PIL not installed: return None -> unknown color
        return None

    try:
        with Image.open(path) as im:
            im = im.convert("RGB")
            w, h = im.size
            if w == 0 or h == 0:
                return None
            pixels = im.load()
            total = [0, 0, 0]
            count = 0
            step = max(1, sample_step)
            for y in range(0, h, step):
                for x in range(0, w, step):
                    r, g, b = pixels[x, y]
                    total[0] += r
                    total[1] += g
                    total[2] += b
                    count += 1
            if count == 0:
                return None
            return (total[0] // count, total[1] // count, total[2] // count)
    except Exception:
        return None


# --- File name parsing --------------------------------------------------------
# Try to extract direction and color from the tokens, otherwise infer them.
DIRECTION_RE = re.compile(r"(front|back|left|right|up|down|unknow)", re.IGNORECASE)

def guess_direction_from_name(name: str) -> str:
    m = DIRECTION_RE.search(name)
    if m:
        return m.group(1).lower()
    return "unknow"

def guess_color_family_from_name(name: str) -> Optional[Tuple[str, str]]:
    # Look for an exact color family name in the name
    for fam in COLOR_FAMILIES.keys():
        if re.search(rf"\b{re.escape(fam)}\b", name, re.IGNORECASE):
            return fam, COLOR_FAMILIES[fam]
    return None

def humanize_name_from_filename(stem: str) -> str:
    # Remove 'front/right/...' tokens and color families from the human-readable name
    base = re.sub(DIRECTION_RE, "", stem, flags=0)
    for fam in COLOR_FAMILIES.keys():
        base = re.sub(rf"\b{re.escape(fam)}\b", "", base, flags=re.IGNORECASE)
    base = re.sub(r"[-_]+", " ", base).strip()
    return base or stem


# --- Data schema --------------------------------------------------------------
@dataclass
class Asset:
    imagePath: str
    name: str
    tags: List[str]
    direction: str
    color: str  # hex
    dateAdded: str = ""
    dateModified: str = ""

def to_dict(a: Asset) -> Dict:
    return {
        "imagePath": a.imagePath,
        "name": a.name,
        "tags": a.tags,
        "direction": a.direction,
        "color": a.color,
        "dateAdded": a.dateAdded,
        "dateModified": a.dateModified,
    }


# --- Name generation and copy -----------------------------------------------
def next_index_for(dist_dir: Path, prefix: str) -> int:
    """
    Find the next free index for files named 'prefix-<n>.png'
    """
    pattern = re.compile(re.escape(prefix) + r"-(\d+)\.png$", re.IGNORECASE)
    max_n = 0
    for p in dist_dir.glob("*.png"):
        m = pattern.match(p.name)
        if m:
            try:
                n = int(m.group(1))
                max_n = max(max_n, n)
            except ValueError:
                pass
    return max_n + 1

def build_filename(name_slug: str, color_family: str, direction: str, index: int) -> str:
    # Ex: chairs-brown-right-34.png
    return f"{name_slug}-{color_family}-{direction}-{index}.png"

def safe_copy(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst)


# --- Extraction from dist (idempotent) ---------------------------------------
def parse_asset_from_dist_file(p: Path, dist_dir: Path) -> Asset:
    """
    Infer metadata from the name "name-color_direction-index.png".
    If any part is missing, fall back to 'unknow' / black hex.
    """
    stem = p.stem
    # Accept the 2 syntaxes seen in the logs:
    #  - "name-color-direction-idx"
    #  - "name-color_direction-idx" (rare)
    # Try the "-" separator first.
    parts = stem.split("-")
    direction = "unknow"
    color_family = None

    # direction: check each part
    for t in parts:
        if t.lower() in ALL_DIRECTIONS:
            direction = t.lower()
            break

    # color: check for an exact family
    for t in parts:
        if t in COLOR_FAMILIES:
            color_family = t
            break

    # human name: stem – (family) – (direction) – (index)
    # remove known tokens and the trailing index
    parts_no_idx = parts[:-1] if parts and parts[-1].isdigit() else parts
    name_tokens = [t for t in parts_no_idx if t not in ALL_DIRECTIONS and t not in COLOR_FAMILIES]
    name_slug = "-".join(name_tokens) or stem
    human = humanize_name_from_filename(name_slug)

    # color hex
    if color_family is None:
        # fallback: black
        color_hex = "#000000"
    else:
        color_hex = COLOR_FAMILIES[color_family]

    rel = p.relative_to(dist_dir).as_posix()
    return Asset(
        imagePath=f"dist/{rel}",
        name=human,
        tags=[],
        direction=direction,
        color=color_hex,
    )


# --- Main pipeline ------------------------------------------------------------
def process_images(model_dir: str, src_dir: str, dist_dir: str, unknow_dir: str) -> Dict:
    """
    - Process new images from `src_dir` and copy them to `dist_dir` under a normalized name
      (name-color_direction-index.png). Images with no detected direction go to `unknow_dir`.
    - Re-scan `dist_dir` to build the collection.
    - Return a dict ready for `assets_list.json`.
    """
    src = Path(src_dir)
    dist = Path(dist_dir)
    unknow = Path(unknow_dir)

    dist.mkdir(parents=True, exist_ok=True)
    unknow.mkdir(parents=True, exist_ok=True)
    src.mkdir(parents=True, exist_ok=True)

    # --- 1) Integrate new images from src_dir
    for fp in sorted(src.rglob("*")):
        if not is_image(fp):
            continue

        stem = fp.stem  # name without extension
        # direction from the name
        direction = guess_direction_from_name(stem)

        # "readable" name
        # (we don't bother recognizing the object via CLIP here — it can be plugged in later)
        name_human = humanize_name_from_filename(stem)
        name_slug = slugify(name_human) or "asset"

        # color – first from the name, otherwise from the RGB average
        fam_hex = guess_color_family_from_name(stem)
        if fam_hex:
            color_family, color_hex = fam_hex
        else:
            rgb = average_rgb(fp)  # None if PIL is missing
            if rgb is None:
                # no PIL: use "grey"
                color_family, color_hex = "grey", COLOR_FAMILIES["grey"]
            else:
                color_family, color_hex = closest_color_family_from_rgb(rgb)

        if direction not in ALL_DIRECTIONS or direction == "unknow":
            # unknown direction -> set aside
            dst = unknow / fp.name
            dst.parent.mkdir(parents=True, exist_ok=True)
            safe_copy(fp, dst)
            continue

        # next index for this (name/color/direction) triplet
        prefix = f"{name_slug}-{color_family}-{direction}"
        index = next_index_for(dist, prefix)
        new_name = build_filename(name_slug, color_family, direction, index)
        dst = dist / new_name

        safe_copy(fp, dst)

    # --- 2) Re-scan dist/ to build the complete collection
    assets: List[Asset] = []
    for p in sorted(dist.glob("*.png")):
        try:
            assets.append(parse_asset_from_dist_file(p, dist))
        except Exception:
            # raw fallback if parsing fails
            rel = p.relative_to(dist).as_posix()
            assets.append(
                Asset(
                    imagePath=f"dist/{rel}",
                    name=humanize_name_from_filename(p.stem),
                    tags=[],
                    direction="unknow",
                    color="#000000",
                )
            )

    # Preserve existing dates; stamp new assets.
    existing = {}
    prev_path = Path("assets_list.json")
    if prev_path.is_file():
        try:
            prev = json.loads(prev_path.read_text(encoding="utf-8"))
            for a in (prev.get("collection") or []):
                ip = a.get("imagePath")
                if ip:
                    existing[ip] = (a.get("dateAdded", ""), a.get("dateModified", ""))
        except Exception:
            pass

    stamp = now_iso()
    for a in assets:
        prev = existing.get(a.imagePath)
        if prev and prev[0]:
            a.dateAdded, a.dateModified = prev[0], prev[1]
        else:
            a.dateAdded, a.dateModified = stamp, ""

    collection = {
        "collectionName": "Assets",
        "tags": [],  # Optional global tags
        "collection": [to_dict(a) for a in assets],
    }
    return collection


def generate_json_file(data: Dict, out_file: str = "assets_list.json", collection_name: str = "Assets") -> None:
    """
    Write the final JSON used by the frontend.
    """
    data = dict(data or {})
    if "collectionName" not in data:
        data["collectionName"] = collection_name
    out = Path(out_file)
    with out.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"[OK] JSON written → {out.resolve()}")

# === Grid processing helpers (added) ==========================================
from PIL import Image
from pathlib import Path as _Path

def trim_transparent_borders(img: Image.Image) -> Image.Image:
    if img.mode not in ("RGBA", "LA"):
        return img.convert("RGBA")
    alpha = img.split()[-1]
    bbox = alpha.getbbox()
    if bbox:
        return img.crop(bbox)
    return img

def pad_to_multiple_of_32_center_x_align_bottom(img: Image.Image) -> Image.Image:
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    w, h = img.size
    new_w = ((w + 31) // 32) * 32
    new_h = ((h + 31) // 32) * 32
    canvas = Image.new("RGBA", (new_w, new_h), (0, 0, 0, 0))
    x = (new_w - w) // 2
    y = new_h - h
    canvas.paste(img, (x, y), img)
    return canvas

def process_image_to_grid(src_path: str, dst_path: str) -> dict:
    try:
        with Image.open(src_path) as im:
            im = im.convert("RGBA")
            im = trim_transparent_borders(im)
            im = pad_to_multiple_of_32_center_x_align_bottom(im)
            _Path(dst_path).parent.mkdir(parents=True, exist_ok=True)
            im.save(dst_path, format="PNG")
        return { "src": str(src_path), "dst": str(dst_path), "status": "ok" }
    except Exception as e:
        return { "src": str(src_path), "dst": str(dst_path), "status": f"error: {e}" }

def process_directory_to_grid(src_dir: str, dst_dir: str) -> dict:
    src = _Path(src_dir)
    dst = _Path(dst_dir)
    results = []
    count = 0
    for p in src.rglob("*.png"):
        rel = p.relative_to(src)
        out = dst / rel
        res = process_image_to_grid(str(p), str(out))
        results.append(res)
        if res.get("status") == "ok":
            count += 1
    return { "processed": count, "results": results }
