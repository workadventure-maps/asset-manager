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
# Si tu veux activer CLIP plus tard, charge-le uniquement quand on scanne.
_model = None
_processor = None

def get_clip():
    """
    Charge CLIP à la demande (lazy). Actuellement non utilisé dans le pipeline de base.
    Tu peux l'activer pour de la reconnaissance + tagging avancé si nécessaire.
    """
    global _model, _processor
    if _model is None or _processor is None:
        print("Chargement CLIP (lazy)…")
        from transformers import CLIPProcessor, CLIPModel  # import tardif
        _model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
        _processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
    return _model, _processor


# --- Couleurs (alignées avec le server.py) -----------------------------------
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


# --- Utilitaires divers -------------------------------------------------------
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
    """Retourne (famille, hex) la plus proche (distance euclidienne)."""
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
    Moyenne rapide des pixels (sous-échantillonnage) pour estimer la teinte dominante.
    """
    try:
        from PIL import Image
    except Exception:
        # PIL pas installée : on renvoie None -> couleur inconnue
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


# --- Parsing de nom de fichier ------------------------------------------------
# On essaie d’extraire direction et couleur à partir des tokens, sinon on déduit.
DIRECTION_RE = re.compile(r"(front|back|left|right|up|down|unknow)", re.IGNORECASE)

def guess_direction_from_name(name: str) -> str:
    m = DIRECTION_RE.search(name)
    if m:
        return m.group(1).lower()
    return "unknow"

def guess_color_family_from_name(name: str) -> Optional[Tuple[str, str]]:
    # Cherche un nom de famille couleur exact dans le nom
    for fam in COLOR_FAMILIES.keys():
        if re.search(rf"\b{re.escape(fam)}\b", name, re.IGNORECASE):
            return fam, COLOR_FAMILIES[fam]
    return None

def humanize_name_from_filename(stem: str) -> str:
    # Supprime tokens 'front/right/...' et familles couleur du nom humain
    base = re.sub(DIRECTION_RE, "", stem, flags=0)
    for fam in COLOR_FAMILIES.keys():
        base = re.sub(rf"\b{re.escape(fam)}\b", "", base, flags=re.IGNORECASE)
    base = re.sub(r"[-_]+", " ", base).strip()
    return base or stem


# --- Schéma de données --------------------------------------------------------
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


# --- Génération de nom et copie ----------------------------------------------
def next_index_for(dist_dir: Path, prefix: str) -> int:
    """
    Cherche le prochain index libre pour des fichiers nommés 'prefix-<n>.png'
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


# --- Extraction depuis dist (idempotent) -------------------------------------
def parse_asset_from_dist_file(p: Path, dist_dir: Path) -> Asset:
    """
    Déduit les métadonnées à partir du nom "name-color_direction-index.png".
    Si l'une manque, on retombe sur des valeurs 'unknow' / hex noir.
    """
    stem = p.stem
    # On accepte les 2 syntaxes vues dans tes logs:
    #  - "name-color-direction-idx"
    #  - "name-color_direction-idx" (rare)
    # On tente d'abord séparateur "-".
    parts = stem.split("-")
    direction = "unknow"
    color_family = None

    # direction: on checke chaque part
    for t in parts:
        if t.lower() in ALL_DIRECTIONS:
            direction = t.lower()
            break

    # couleur: on checke famille exacte
    for t in parts:
        if t in COLOR_FAMILIES:
            color_family = t
            break

    # name humain: stem – (famille) – (direction) – (index)
    # on retire les tokens connus et l'index final
    parts_no_idx = parts[:-1] if parts and parts[-1].isdigit() else parts
    name_tokens = [t for t in parts_no_idx if t not in ALL_DIRECTIONS and t not in COLOR_FAMILIES]
    name_slug = "-".join(name_tokens) or stem
    human = humanize_name_from_filename(name_slug)

    # hex couleur
    if color_family is None:
        # fallback: noir
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


# --- Pipeline principal -------------------------------------------------------
def process_images(model_dir: str, src_dir: str, dist_dir: str, unknow_dir: str) -> Dict:
    """
    - Traite les nouvelles images de `src_dir` et les copie vers `dist_dir` sous un nom normalisé
      (name-color_direction-index.png). Les images sans direction détectée vont dans `unknow_dir`.
    - Re-scanne `dist_dir` pour construire la collection.
    - Retourne un dict prêt pour `assets_list.json`.
    """
    src = Path(src_dir)
    dist = Path(dist_dir)
    unknow = Path(unknow_dir)

    dist.mkdir(parents=True, exist_ok=True)
    unknow.mkdir(parents=True, exist_ok=True)
    src.mkdir(parents=True, exist_ok=True)

    # --- 1) Intégrer nouvelles images depuis src_dir
    for fp in sorted(src.rglob("*")):
        if not is_image(fp):
            continue

        stem = fp.stem  # nom sans extension
        # direction par le nom
        direction = guess_direction_from_name(stem)

        # nom "lisible"
        # (on ne s'embête pas ici à reconnaitre l'objet via CLIP — tu pourras plugger plus tard)
        name_human = humanize_name_from_filename(stem)
        name_slug = slugify(name_human) or "asset"

        # couleur – d'abord via le nom, sinon via moyenne RGB
        fam_hex = guess_color_family_from_name(stem)
        if fam_hex:
            color_family, color_hex = fam_hex
        else:
            rgb = average_rgb(fp)  # None si PIL manquant
            if rgb is None:
                # pas de PIL: mets "grey"
                color_family, color_hex = "grey", COLOR_FAMILIES["grey"]
            else:
                color_family, color_hex = closest_color_family_from_rgb(rgb)

        if direction not in ALL_DIRECTIONS or direction == "unknow":
            # direction inconnue -> on met de côté
            dst = unknow / fp.name
            dst.parent.mkdir(parents=True, exist_ok=True)
            safe_copy(fp, dst)
            continue

        # index suivant pour ce triplet (name/color/direction)
        prefix = f"{name_slug}-{color_family}-{direction}"
        index = next_index_for(dist, prefix)
        new_name = build_filename(name_slug, color_family, direction, index)
        dst = dist / new_name

        safe_copy(fp, dst)

    # --- 2) Re-scan dist/ pour construire la collection complète
    assets: List[Asset] = []
    for p in sorted(dist.glob("*.png")):
        try:
            assets.append(parse_asset_from_dist_file(p, dist))
        except Exception:
            # fallback brut si parsing échoue
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

    # Préserve les dates existantes; tamponne les nouveaux assets.
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
        "tags": [],  # Global tags optionnels
        "collection": [to_dict(a) for a in assets],
    }
    return collection


def generate_json_file(data: Dict, out_file: str = "assets_list.json", collection_name: str = "Assets") -> None:
    """
    Écrit le JSON final utilisé par le front.
    """
    data = dict(data or {})
    if "collectionName" not in data:
        data["collectionName"] = collection_name
    out = Path(out_file)
    with out.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"[OK] JSON écrit → {out.resolve()}")

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
