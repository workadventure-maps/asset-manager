# server.py
# Simple HTTP server with API endpoints for the asset manager

from __future__ import annotations
import http.server
import socketserver
import json
import os
import shutil
import mimetypes
from urllib.parse import urlparse
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
VALIDATE_DIR = "validate elements"

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
        # Map /collisions to collisions.html (added)
        if self.path.split('?')[0] == '/collisions':
            self.path = '/collisions.html'
        # Comportement par défaut de SimpleHTTPRequestHandler (fichiers statiques)
        return super().do_GET()
        if route == "/add-assets":
            return send_file(self, "add_assets.html")
            if route == "/upload_files":
                try:
                    import cgi
                    from pathlib import Path
                    fs = cgi.FieldStorage(
                        fp=self.rfile,
                        headers=self.headers,
                        environ={
                            "REQUEST_METHOD": "POST",
                            "CONTENT_TYPE": self.headers.get("Content-Type"),
                        },
                        keep_blank_values=True
                    )

                    fields = fs["files"] if "files" in fs else None
                    if fields is None:
                        if "file" in fs:
                            fields = fs["file"]
                        else:
                            return send_json(self, 400, {"status":"error","message":"No files field in form"})

                    if not isinstance(fields, list):
                        fields = [fields]

                    dist_root = Path("dist")
                    saved = 0
                    errors = []
                    for part in fields:
                        filename = getattr(part, "filename", "") or ""
                        rel = filename.replace("\\\\", "/").lstrip("./").strip("/")
                        if not rel or ".." in rel:
                            errors.append({"file": filename, "error": "invalid relative path"})
                            continue
                        dest = dist_root / rel
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        with open(dest, "wb") as outf:
                            data = part.file.read()
                            outf.write(data)
                        saved += 1

                    return send_json(self, 200, {"status":"success", "saved": saved, "errors": errors})
                except Exception as e:
                    return send_json(self, 500, {"status":"error", "message": str(e)})



    def do_POST(self):
        route = urlparse(self.path).path

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
        # (Optionnel) Recompute colors stub — si ton UI l’appelle
        # Body attendu: { "items":[ { "imagePath": "...", "hex": "#AABBCC" }, ... ] }
        # Répond avec un echo/result minimal pour compat.
        # ---------------------------------------------------------------------
        if route == "/update_colors":
            body = read_json_body(self) or {}
            items = body.get("items") or []
            # Ici on pourrait recalculer des familles de couleurs si tu as une logique spécifique.
            # Pour compat, on renvoie un succès avec le même nombre d’items.
            return send_json(self, 200, {"status": "success", "updated": len(items)})

        # ---------------------------------------------------------------------
        # Validate selection: copie/renomme côté serveur
        # Body attendu: { "targetDir": "validate elements", "items":[{ imagePath, newFilename, ... }, ...] }
        # ---------------------------------------------------------------------
        if route == "/validate_selection":
            body = read_json_body(self) or {}
            # Backward compatibility:
            # - Old: { "targetDir": "validate elements", "items":[...]}  -> copies to targetDir with optional renaming
            # - New: { "baseDir":"validate-elements", "subDir":"<name>", "items":[...], "json":{...} }
            #         -> creates baseDir/subDir, copies images preserving original imagePath structure,
            #            and writes assets_list.json with provided subset JSON.
            items = body.get("items") or []
            if not isinstance(items, list):
                return send_json(self, 400, {"status": "error", "message": "items must be a list"})

            base_dir = (body.get("baseDir") or "").strip()
            sub_dir = (body.get("subDir") or "").strip()
            target_dir = (body.get("targetDir") or "").strip()

            if base_dir and sub_dir:
                dest_root = Path(base_dir) / sub_dir
                preserve_paths = True  # new flow: keep imagePath structure
            else:
                # fallback to old behavior
                dest_root = Path(target_dir or VALIDATE_DIR)
                preserve_paths = False

            dest_root.mkdir(parents=True, exist_ok=True)

            copied = 0
            errors = []

            def safe_ensure_dir(dst_path: Path):
                dst_path.parent.mkdir(parents=True, exist_ok=True)

            for it in items:
                src_rel = (it.get("imagePath") or "").strip()
                new_name = (it.get("newFilename") or "").strip()
                if not src_rel:
                    errors.append({"item": it, "error": "missing imagePath"})
                    continue
                try:
                    src = Path(src_rel)
                    if not src.exists():
                        # try relative to dist folder if path not absolute
                        alt = Path(DIST_DIR) / src_rel if not src.is_absolute() else None
                        if alt and alt.exists():
                            src = alt
                        else:
                            raise FileNotFoundError(f"Source not found: {src_rel}")

                    if preserve_paths:
                        dst = dest_root / src_rel
                    else:
                        # old behavior: copy into dest root, optionally renamed
                        if not new_name:
                            new_name = src.name
                        dst = dest_root / new_name

                    safe_ensure_dir(dst)
                    shutil.copy2(src, dst)
                    copied += 1
                except Exception as e:
                    errors.append({"item": it, "error": str(e)})

            # Write subset JSON if provided (new flow)
            subset = body.get("json")
            json_written = False
            if isinstance(subset, dict):
                try:
                    out_json_path = dest_root / "assets_list.json"
                    with open(out_json_path, "w", encoding="utf-8") as f:
                        json.dump(subset, f, indent=2, ensure_ascii=False)
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
def run_server(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT):
    with socketserver.TCPServer((host, port), Handler) as httpd:
        print(f"Serving at http://{host}:{port}")
        httpd.serve_forever()

if __name__ == "__main__":
    run_server()