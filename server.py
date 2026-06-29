# server.py
# Simple HTTP server with API endpoints for the asset manager

from __future__ import annotations
import http.server
import socketserver
import json
import os
import shutil
import mimetypes
import uuid
import datetime
from urllib.parse import urlparse, parse_qs
from pathlib import Path

# -----------------------------------------------------------------------------
# Config
# -----------------------------------------------------------------------------
DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 8000
ASSETS_JSON = "assets_list.json"

# Dossiers par défaut
DIST_DIR = "dist"
DIST32_DIR = "dist32"
VALIDATED_DIR = "validated"

# -----------------------------------------------------------------------------
# Utils
# -----------------------------------------------------------------------------
def read_json_body(handler: http.server.BaseHTTPRequestHandler):
    length = int(handler.headers.get("Content-Length", 0))
    if not length:
        return None
    try:
        raw = handler.rfile.read(length).decode("utf-8", errors="replace")
        return json.loads(raw)
    except Exception:
        return None

def safe_ensure_dir(p: Path):
    p.parent.mkdir(parents=True, exist_ok=True)

def send_json(handler: http.server.BaseHTTPRequestHandler, code: int, payload: dict):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)

# -----------------------------------------------------------------------------
# Image processing helpers (importés dynamiquement si dispo)
# -----------------------------------------------------------------------------
def process_directory_to_grid_wrapper(src_dir: str, dst_dir: str) -> dict:
    """
    Wrapper pour importer et appeler les helpers depuis image_processor.py.
    """
    from importlib import import_module
    try:
        ip = import_module("image_processor")
    except Exception as e:
        raise RuntimeError(f"Cannot import image_processor: {e}")

    if not hasattr(ip, "process_directory_to_grid"):
        raise RuntimeError("image_processor.process_directory_to_grid not found")

    return ip.process_directory_to_grid(src_dir, dst_dir)

# -----------------------------------------------------------------------------
# HTTP Handler
# -----------------------------------------------------------------------------
class Handler(http.server.SimpleHTTPRequestHandler):

    # Ajout CORS + désactivation du cache agressif côté dev
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    # L’UI fait des HEAD sur les images pour récupérer Content-Length
    def do_HEAD(self):
        path = self.translate_path(self.path)
        p = Path(path)
        if p.is_file():
            ctype = mimetypes.guess_type(str(p))[0] or "application/octet-stream"
            try:
                size = p.stat().st_size
            except Exception:
                size = 0
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(size))
            self.end_headers()
        else:
            self.send_error(404, "File not found")

    def do_GET(self):
        # Routes "jolies" -> fichiers HTML statiques
        parsed_url = urlparse(self.path)
        route = parsed_url.path
        qs = parse_qs(parsed_url.query)
        if route == '/list_collections':
            return self.list_collections()
        if route == '/list_versions':
            dir_name = (qs.get("dir") or [""])[0].strip().strip("/\\")
            if not dir_name or ".." in dir_name.split("/"):
                return send_json(self, 400, {"status": "error", "message": "Invalid dir"})
            versions_path = Path(VALIDATED_DIR) / dir_name / "_versions"
            if not versions_path.is_dir():
                return send_json(self, 200, {"versions": []})
            versions = sorted(
                [d.name for d in versions_path.iterdir() if d.is_dir()],
                reverse=True
            )
            return send_json(self, 200, {"versions": versions})
        if route in ('/', '/index'):
            self.path = '/index.html'
        elif route == '/collisions':
            self.path = '/collisions.html'
        elif route in ('/add-assets', '/add_assets'):
            self.path = '/add_assets.html'
        elif route == '/align':
            self.path = '/align.html'
        elif route == '/compose':
            self.path = '/compose.html'
        elif route in ('/collection-list', '/collection_list', '/collections'):
            self.path = '/collection_list.html'

        # Comportement par défaut de SimpleHTTPRequestHandler (fichiers statiques)
        return super().do_GET()

    def list_collections(self):
        """Scanne récursivement validated/ : tous les fichiers .json contenant une clé
        'collection' sont retournés. collection_thumbnail.jpg/png dans le même dossier
        est utilisé comme miniature en priorité sur le premier asset."""
        base = Path(VALIDATED_DIR)
        items = []
        if not base.is_dir():
            return send_json(self, 200, {"collections": items})

        for jf in sorted(base.rglob("*.json")):
            if "_versions" in jf.parts:
                continue
            d = jf.parent
            try:
                data = json.loads(jf.read_text(encoding="utf-8"))
            except Exception:
                continue
            # On ignore les JSON qui ne ressemblent pas à une collection
            if not isinstance(data.get("collection"), list):
                continue

            coll = data["collection"]
            rel_dir = d.relative_to(base).as_posix()

            # Thumbnail : collection_thumbnail.jpg/png en priorité, sinon premier asset
            thumb = None
            for ext in ("jpg", "jpeg", "png", "webp"):
                candidate = d / f"collection_thumbnail.{ext}"
                if candidate.is_file():
                    thumb = f"{VALIDATED_DIR}/{rel_dir}/collection_thumbnail.{ext}"
                    break
            if thumb is None and coll and isinstance(coll[0], dict) and coll[0].get("imagePath"):
                img_name = str(coll[0]["imagePath"]).split("/")[-1]
                if img_name:
                    thumb = f"{VALIDATED_DIR}/{rel_dir}/{img_name}"

            items.append({
                "dir": rel_dir,
                "jsonFile": jf.name,
                "collectionName": data.get("collectionName") or rel_dir,
                "tags": data.get("tags") or [],
                "count": len(coll),
                "thumb": thumb,
            })

        return send_json(self, 200, {"collections": items})

    def handle_upload(self):
        """Reçoit un multipart/form-data (champ 'files' ou 'file') et écrit les
        fichiers sous dist/ en préservant leur chemin relatif."""
        try:
            import cgi
            fs = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={
                    "REQUEST_METHOD": "POST",
                    "CONTENT_TYPE": self.headers.get("Content-Type", ""),
                },
                keep_blank_values=True
            )

            fields = fs["files"] if "files" in fs else (fs["file"] if "file" in fs else None)
            if fields is None:
                return send_json(self, 400, {"status": "error", "message": "No files field in form"})

            if not isinstance(fields, list):
                fields = [fields]

            dist_root = Path(DIST_DIR)
            saved = 0
            errors = []
            for part in fields:
                filename = getattr(part, "filename", "") or ""
                rel = filename.replace("\\", "/").lstrip("./").strip("/")
                if not rel or ".." in rel.split("/"):
                    errors.append({"file": filename, "error": "invalid relative path"})
                    continue
                dest = dist_root / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                with open(dest, "wb") as outf:
                    outf.write(part.file.read())
                saved += 1

            return send_json(self, 200, {"status": "success", "saved": saved, "errors": errors})
        except Exception as e:
            return send_json(self, 500, {"status": "error", "message": str(e)})

    def do_POST(self):
        route = urlparse(self.path).path

        # Upload d'images depuis add_assets.html -> dist/
        if route == "/upload_files":
            return self.handle_upload()

        # ---------------------------------------------------------------------
        if route == "/restore_version":
            body = read_json_body(self) or {}
            dir_name = (body.get("dir") or "").strip().strip("/\\")
            version   = (body.get("version") or "").strip()
            if not dir_name or not version or ".." in dir_name or ".." in version:
                return send_json(self, 400, {"status": "error", "message": "Invalid dir or version"})
            dest_root   = Path(VALIDATED_DIR) / dir_name
            version_dir = dest_root / "_versions" / version
            if not version_dir.is_dir():
                return send_json(self, 404, {"status": "error", "message": "Version not found"})
            try:
                # Backup current state before restoring
                ts = datetime.datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
                backup_dir = dest_root / "_versions" / ts
                backup_dir.mkdir(parents=True, exist_ok=True)
                for item in dest_root.iterdir():
                    if item.name == "_versions": continue
                    if item.is_file(): shutil.copy2(item, backup_dir / item.name)
                # Clear current
                for item in dest_root.iterdir():
                    if item.name == "_versions": continue
                    if item.is_file(): item.unlink()
                # Restore version
                for item in version_dir.iterdir():
                    if item.is_file(): shutil.copy2(item, dest_root / item.name)
                return send_json(self, 200, {"status": "success"})
            except Exception as e:
                return send_json(self, 500, {"status": "error", "message": str(e)})

        # ---------------------------------------------------------------------
        # NEW: Process all PNGs in dist32/ -> write normalized versions into dist32/
        #      Trim transparent edges, then pad to multiples of 32,
        #      centered on X and bottom-aligned on Y.
        # ---------------------------------------------------------------------
        if route == "/resize_to_grid_to_dir":
            try:
                os.makedirs(DIST32_DIR, exist_ok=True)
                result = process_directory_to_grid_wrapper(DIST_DIR, DIST32_DIR)
                return send_json(self, 200, {
                    "status": "success",
                    "processed": result.get("processed", 0),
                    "dst": DIST32_DIR,
                    "results": result.get("results", [])
                })
            except Exception as e:
                return send_json(self, 500, {"status": "error", "message": str(e)})

        # ---------------------------------------------------------------------
        # Use a validated collection as the project-root default assets_list.json.
        # Image paths are rewritten to validated/<dir>/<file> so they resolve.
        # Body attendu: { "dir": "<name>" }
        # ---------------------------------------------------------------------
        if route == "/use_as_default":
            body = read_json_body(self) or {}
            json_file = (body.get("jsonFile") or "assets_list.json").strip().lstrip("/\\")
            sub = (body.get("dir") or "").strip().strip("/\\").replace("\\", "/")
            # Prevent path traversal: no ".." segment allowed anywhere
            all_parts = (sub + "/" + json_file).split("/")
            if not sub or ".." in all_parts or not json_file.endswith(".json"):
                return send_json(self, 400, {"status": "error", "message": "Invalid directory or file"})
            src_json = Path(VALIDATED_DIR) / sub / json_file
            if not src_json.is_file():
                return send_json(self, 404, {"status": "error", "message": "Collection not found"})
            try:
                data = json.loads(src_json.read_text(encoding="utf-8"))
                out = dict(data)
                out.pop("imageBase", None)
                new_coll = []
                for a in (data.get("collection") or []):
                    a2 = dict(a)
                    name = str(a2.get("imagePath", "")).split("/")[-1]
                    if name:
                        a2["imagePath"] = f"{VALIDATED_DIR}/{sub}/{name}"
                    new_coll.append(a2)
                out["collection"] = new_coll
                with open(ASSETS_JSON, "w", encoding="utf-8") as f:
                    json.dump(out, f, indent=2, ensure_ascii=False)
                return send_json(self, 200, {
                    "status": "success",
                    "collectionName": out.get("collectionName"),
                    "count": len(new_coll),
                })
            except Exception as e:
                return send_json(self, 500, {"status": "error", "message": str(e)})

        # ---------------------------------------------------------------------
        # Append one asset entry to the root assets_list.json. Used when an asset
        # is duplicated/mirrored on align.html.
        # Body attendu: { "asset": { imagePath, name, ... } }
        # ---------------------------------------------------------------------
        if route == "/update_asset":
            body = read_json_body(self) or {}
            image_path = body.get("imagePath")
            updates = body.get("updates", {})
            if not image_path or not isinstance(updates, dict):
                return send_json(self, 400, {"status": "error", "message": "imagePath and updates required"})
            try:
                p = Path(ASSETS_JSON)
                data = json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {}
                found = False
                for asset in data.get("collection", []):
                    if isinstance(asset, dict) and asset.get("imagePath") == image_path:
                        asset.update(updates)
                        found = True
                        break
                if not found:
                    return send_json(self, 404, {"status": "error", "message": "Asset not found"})
                p.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
                return send_json(self, 200, {"status": "success"})
            except Exception as e:
                return send_json(self, 500, {"status": "error", "message": str(e)})

        # ---------------------------------------------------------------------
        if route == "/append_asset":
            body = read_json_body(self) or {}
            asset = body.get("asset")
            if not isinstance(asset, dict) or not asset.get("imagePath"):
                return send_json(self, 400, {"status": "error", "message": "Invalid asset"})
            try:
                asset.setdefault("id", new_id())
                data = {"collectionName": "Assets", "tags": [], "collection": []}
                p = Path(ASSETS_JSON)
                if p.is_file():
                    try:
                        data = json.loads(p.read_text(encoding="utf-8"))
                    except Exception:
                        pass
                data.setdefault("collection", []).append(asset)
                with open(ASSETS_JSON, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
                return send_json(self, 200, {"status": "success", "count": len(data["collection"])})
            except Exception as e:
                return send_json(self, 500, {"status": "error", "message": str(e)})

        # ---------------------------------------------------------------------
        if route == "/append_composition":
            body = read_json_body(self) or {}
            comp = body.get("composition")
            if not isinstance(comp, dict) or not comp.get("name") or not comp.get("layers"):
                return send_json(self, 400, {"status": "error", "message": "Invalid composition"})
            try:
                comp.pop("type", None)
                comp.setdefault("id", new_id())
                data = {"collectionName": "Assets", "tags": [], "collection": [], "compositions": []}
                p = Path(ASSETS_JSON)
                if p.is_file():
                    try:
                        data = json.loads(p.read_text(encoding="utf-8"))
                    except Exception:
                        pass
                data.setdefault("compositions", []).append(comp)
                with open(ASSETS_JSON, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
                return send_json(self, 200, {"status": "success", "count": len(data["compositions"])})
            except Exception as e:
                return send_json(self, 500, {"status": "error", "message": str(e)})

        # ---------------------------------------------------------------------
        # Save an (aligned) PNG back to a relative project path. Used by align.html.
        # Body attendu: { "path": "dist/foo.png", "dataUrl": "data:image/png;base64,..." }
        # ---------------------------------------------------------------------
        if route == "/save_image":
            body = read_json_body(self) or {}
            rel = (body.get("path") or "").strip().replace("\\", "/").lstrip("/")
            data_url = body.get("dataUrl") or ""
            if not rel or ".." in rel.split("/"):
                return send_json(self, 400, {"status": "error", "message": "Invalid path"})
            if not data_url.startswith("data:image/png;base64,"):
                return send_json(self, 400, {"status": "error", "message": "Expected a PNG data URL"})
            try:
                import base64
                raw = base64.b64decode(data_url.split(",", 1)[1])
                p = Path(rel)
                if p.is_absolute():
                    return send_json(self, 400, {"status": "error", "message": "Absolute paths are not allowed"})
                p.parent.mkdir(parents=True, exist_ok=True)
                with open(p, "wb") as f:
                    f.write(raw)
                return send_json(self, 200, {"status": "success", "path": rel, "bytes": len(raw)})
            except Exception as e:
                return send_json(self, 500, {"status": "error", "message": str(e)})

        # ---------------------------------------------------------------------
        # Update assets_list.json (overwrite with posted content)
        # Body attendu: (l’objet JSON complet de la collection)
        # ---------------------------------------------------------------------
        if route == "/":
            data = read_json_body(self)
            if not isinstance(data, dict):
                return send_json(self, 400, {"status": "error", "message": "Invalid JSON body"})
            try:
                with open(ASSETS_JSON, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
                return send_json(self, 200, {"status": "success", "message": "assets_list.json updated"})
            except Exception as e:
                return send_json(self, 500, {"status": "error", "message": str(e)})

        # ---------------------------------------------------------------------
        # Validate selection: crée validated/<dir> avec les images (à plat)
        # et le JSON au même niveau. Refuse si le dossier existe déjà.
        # Body attendu: { "dir": "<name>", "items":[{ imagePath, newFilename }], "json": {...} }
        # ---------------------------------------------------------------------
        if route == "/validate_selection":
            body = read_json_body(self) or {}
            items = body.get("items") or []
            if not isinstance(items, list):
                return send_json(self, 400, {"status": "error", "message": "items must be a list"})

            sub_dir = (body.get("dir") or body.get("subDir") or "").strip().strip("/\\")
            if not sub_dir:
                return send_json(self, 400, {"status": "error", "message": "Missing directory name"})
            if "/" in sub_dir or "\\" in sub_dir or sub_dir in (".", ".."):
                return send_json(self, 400, {"status": "error", "message": "Invalid directory name"})

            overwrite = bool(body.get("overwrite"))
            dest_root = Path(VALIDATED_DIR) / sub_dir

            if dest_root.exists():
                if not overwrite:
                    return send_json(self, 409, {
                        "status": "exists",
                        "message": f'Folder "{VALIDATED_DIR}/{sub_dir}" already exists',
                    })
                # Backup current contents to _versions/<timestamp>/
                ts = datetime.datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
                backup_dir = dest_root / "_versions" / ts
                backup_dir.mkdir(parents=True, exist_ok=True)
                for item in dest_root.iterdir():
                    if item.name == "_versions":
                        continue
                    if item.is_file():
                        shutil.copy2(item, backup_dir / item.name)
                # Clear current files (keep _versions/)
                for item in dest_root.iterdir():
                    if item.name == "_versions":
                        continue
                    if item.is_file():
                        item.unlink()
            else:
                try:
                    dest_root.mkdir(parents=True, exist_ok=False)
                except FileExistsError:
                    return send_json(self, 409, {
                        "status": "exists",
                        "message": f'Folder "{VALIDATED_DIR}/{sub_dir}" already exists',
                    })

            copied = 0
            errors = []
            name_map = {}  # imagePath d'origine -> nom de fichier copié

            for it in items:
                src_rel = (it.get("imagePath") or "").strip()
                if not src_rel:
                    errors.append({"item": it, "error": "missing imagePath"})
                    continue
                try:
                    src = Path(src_rel)
                    if not src.exists():
                        alt = Path(DIST_DIR) / src_rel if not src.is_absolute() else None
                        if alt and alt.exists():
                            src = alt
                        else:
                            raise FileNotFoundError(f"Source not found: {src_rel}")

                    # Copie à plat dans le dossier, nom = newFilename sinon nom d'origine
                    dst_name = (it.get("newFilename") or src.name).strip() or src.name
                    dst = dest_root / dst_name
                    if dst.exists():
                        stem, suffix, k = dst.stem, dst.suffix, 1
                        while (dest_root / f"{stem}-{k}{suffix}").exists():
                            k += 1
                        dst = dest_root / f"{stem}-{k}{suffix}"
                        dst_name = dst.name

                    shutil.copy2(src, dst)
                    name_map[src_rel] = dst_name
                    copied += 1
                except Exception as e:
                    errors.append({"item": it, "error": str(e)})

            # JSON au même niveau, avec imagePath réécrit vers le fichier copié
            subset = body.get("json")
            json_written = False
            if isinstance(subset, dict):
                try:
                    out = dict(subset)
                    # Hint so the UI can resolve image paths when this pack is reloaded.
                    out["imageBase"] = f"{VALIDATED_DIR}/{sub_dir}"
                    out["collection"] = []
                    for a in (subset.get("collection") or []):
                        a2 = dict(a)
                        if a2.get("imagePath") in name_map:
                            a2["imagePath"] = name_map[a2["imagePath"]]
                        out["collection"].append(a2)
                    with open(dest_root / "assets_list.json", "w", encoding="utf-8") as f:
                        json.dump(out, f, indent=2, ensure_ascii=False)
                    json_written = True
                except Exception as e:
                    errors.append({"json": "assets_list.json", "error": str(e)})

            return send_json(self, 200, {
                "status": "success",
                "copied": copied,
                "json_written": json_written,
                "destination": str(dest_root),
                "errors": errors
            })

        # Route inconnue
        return send_json(self, 404, {"status": "error", "message": f"Unknown route: {route}"})


# -----------------------------------------------------------------------------
# Entry point
# -----------------------------------------------------------------------------
class ReusableTCPServer(socketserver.TCPServer):
    # Permet de relancer immédiatement le serveur sans attendre la fin du TIME_WAIT.
    allow_reuse_address = True


def new_id() -> str:
    return str(uuid.uuid4())


def migrate_ids():
    """Add uuid4 ids to any asset or composition that is missing one."""
    p = Path(ASSETS_JSON)
    if not p.is_file():
        return
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return
    changed = False
    for item in data.get("collection", []):
        if isinstance(item, dict) and not item.get("id"):
            item["id"] = new_id()
            changed = True
    for item in data.get("compositions", []):
        if isinstance(item, dict) and not item.get("id"):
            item["id"] = new_id()
            changed = True
    if changed:
        p.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"[migrate_ids] assigned ids to existing entries")


def run_server(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT):
    migrate_ids()
    with ReusableTCPServer((host, port), Handler) as httpd:
        print(f"Serving at http://{host}:{port}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopping server…")

if __name__ == "__main__":
    run_server()