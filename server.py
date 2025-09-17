# server.py
import http.server
import socketserver
import json
import os
import shutil
from urllib.parse import urlparse

DEFAULT_PORT = 8000
ASSETS_FILE = 'assets_list.json'

# --- Données couleur (inchangées) ---
color_families = {
    "red": {"hex": "#FF0000", "min_rgb": [200, 0, 0], "max_rgb": [255, 100, 100]},
    "maroon": {"hex": "#800000", "min_rgb": [100, 0, 0], "max_rgb": [150, 50, 50]},
    "crimson": {"hex": "#DC143C", "min_rgb": [200, 20, 40], "max_rgb": [240, 60, 80]},
    "coral": {"hex": "#FF7F50", "min_rgb": [250, 120, 80], "max_rgb": [255, 150, 110]},
    "blue": {"hex": "#0000FF", "min_rgb": [0, 0, 200], "max_rgb": [100, 100, 255]},
    "navy": {"hex": "#000080", "min_rgb": [0, 0, 100], "max_rgb": [50, 50, 150]},
    "teal": {"hex": "#008080", "min_rgb": [0, 100, 100], "max_rgb": [50, 150, 150]},
    "cyan": {"hex": "#00FFFF", "min_rgb": [0, 200, 200], "max_rgb": [100, 255, 255]},
    "light_blue": {"hex": "#ADD8E6", "min_rgb": [150, 200, 220], "max_rgb": [200, 255, 255]},
    "yellow": {"hex": "#FFFF00", "min_rgb": [200, 200, 0], "max_rgb": [255, 255, 100]},
    "gold": {"hex": "#FFD700", "min_rgb": [200, 200, 0], "max_rgb": [255, 220, 50]},
    "green": {"hex": "#00FF00", "min_rgb": [0, 200, 0], "max_rgb": [100, 255, 100]},
    "lime": {"hex": "#00FF00", "min_rgb": [100, 200, 0], "max_rgb": [150, 255, 50]},
    "forest_green": {"hex": "#228B22", "min_rgb": [30, 120, 30], "max_rgb": [70, 150, 70]},
    "olive": {"hex": "#808000", "min_rgb": [100, 100, 0], "max_rgb": [150, 150, 50]},
    "brown": {"hex": "#A52A2A", "min_rgb": [150, 50, 0], "max_rgb": [200, 100, 50]},
    "chocolate": {"hex": "#D2691E", "min_rgb": [180, 80, 20], "max_rgb": [220, 120, 60]},
    "saddlebrown": {"hex": "#8B4513", "min_rgb": [120, 50, 10], "max_rgb": [150, 80, 40]},
    "orange": {"hex": "#FFA500", "min_rgb": [200, 100, 0], "max_rgb": [255, 165, 50]},
    "purple": {"hex": "#800080", "min_rgb": [100, 0, 100], "max_rgb": [150, 50, 150]},
    "magenta": {"hex": "#FF00FF", "min_rgb": [200, 0, 200], "max_rgb": [255, 100, 255]},
    "fuchsia": {"hex": "#FF00FF", "min_rgb": [200, 0, 200], "max_rgb": [255, 100, 255]},
    "pink": {"hex": "#FFC0CB", "min_rgb": [250, 150, 150], "max_rgb": [255, 200, 200]},
    "hot_pink": {"hex": "#FF69B4", "min_rgb": [250, 100, 150], "max_rgb": [255, 150, 200]},
    "grey": {"hex": "#808080", "min_rgb": [100, 100, 100], "max_rgb": [150, 150, 150]},
    "dark_grey": {"hex": "#A9A9A9", "min_rgb": [150, 150, 150], "max_rgb": [180, 180, 180]},
    "light_grey": {"hex": "#D3D3D3", "min_rgb": [200, 200, 200], "max_rgb": [220, 220, 220]},
    "black": {"hex": "#000000", "min_rgb": [0, 0, 0], "max_rgb": [50, 50, 50]},
    "white": {"hex": "#FFFFFF", "min_rgb": [240, 240, 240], "max_rgb": [255, 255, 255]},
    "beige": {"hex": "#F5F5DC", "min_rgb": [220, 220, 190], "max_rgb": [255, 255, 230]},
    "tan": {"hex": "#D2B48C", "min_rgb": [190, 160, 120], "max_rgb": [220, 190, 150]}
}

def hex_to_rgb(hex_code):
    hex_code = hex_code.lstrip('#')
    return tuple(int(hex_code[i:i+2], 16) for i in (0, 2, 4))

def find_color_family(rgb):
    r, g, b = rgb
    for family, data in color_families.items():
        min_r, min_g, min_b = data["min_rgb"]
        max_r, max_g, max_b = data["max_rgb"]
        if min_r <= r <= max_r and min_g <= g <= max_g and min_b <= b <= max_b:
            return family, data["hex"]
    return None, None

def update_json_colors(file_path):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if "collection" in data:
            for asset in data["collection"]:
                if "color" in asset:
                    hex_color = asset["color"]
                    r, g, b = hex_to_rgb(hex_color)
                    family, new_hex_code = find_color_family((r, g, b))
                    if new_hex_code:
                        asset["color"] = new_hex_code
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
        return True, "Fichier JSON mis à jour avec les nouvelles couleurs de famille."
    except Exception as e:
        return False, f"Erreur lors de la mise à jour du fichier JSON: {e}"

def safe_join(base, *paths):
    base = os.path.abspath(base)
    final_path = os.path.abspath(os.path.join(base, *paths))
    if not final_path.startswith(base + os.sep) and final_path != base:
        raise ValueError("Unsafe path.")
    return final_path

def read_json_body(handler):
    length = int(handler.headers.get('Content-Length', 0) or 0)
    raw = handler.rfile.read(length) if length > 0 else b'{}'
    try:
        return json.loads(raw.decode('utf-8') or '{}')
    except Exception:
        return None

class MyHandler(http.server.SimpleHTTPRequestHandler):
    # CORS
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        return super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        route = urlparse(self.path).path

        if route == '/':
            # MAJ assets_list.json
            data = read_json_body(self)
            if data is None:
                return self._json(400, {"status": "error", "message": "JSON invalide"})
            try:
                with open(ASSETS_FILE, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=4, ensure_ascii=False)
                return self._json(200, {"status": "success", "message": "Fichier JSON mis à jour."})
            except Exception as e:
                return self._json(500, {"status": "error", "message": str(e)})

        elif route == '/update_colors':
            success, message = update_json_colors(ASSETS_FILE)
            code = 200 if success else 500
            return self._json(code, {"status": "success" if success else "error", "message": message})

        elif route == '/validate_selection':
            data = read_json_body(self)
            if data is None:
                return self._json(400, {"ok": False, "error": "JSON invalide"})

            target_dir_name = data.get('targetDir') or 'validate elements'
            items = data.get('items') or []
            if not isinstance(items, list):
                return self._json(400, {"ok": False, "error": '"items" must be an array'})

            try:
                base = os.getcwd()
                target_dir = safe_join(base, target_dir_name)
                os.makedirs(target_dir, exist_ok=True)

                results = []
                for it in items:
                    image_path = (it.get('imagePath') or '').lstrip('/\\')
                    new_filename = it.get('newFilename') or 'unnamed.png'
                    if not new_filename.lower().endswith('.png'):
                        new_filename = new_filename + '.png'

                    try:
                        src = safe_join(base, image_path)
                    except ValueError:
                        results.append({"imagePath": image_path, "newFilename": new_filename, "status": "unsafe-path"})
                        continue

                    dst = os.path.join(target_dir, new_filename)

                    if not os.path.isfile(src):
                        results.append({"imagePath": image_path, "newFilename": new_filename, "status": "missing"})
                        continue

                    try:
                        shutil.copyfile(src, dst)
                        results.append({"imagePath": image_path, "newFilename": new_filename, "status": "copied"})
                    except Exception as e:
                        results.append({"imagePath": image_path, "newFilename": new_filename, "status": f"error: {e}"})

                subset = {
                    "collectionName": "validated-selection",
                    "tags": [],
                    "collection": [{
                        "imagePath": f"{target_dir_name}/{(it.get('newFilename') or 'unnamed.png')}",
                        "name": it.get("name") or "",
                        "tags": it.get("tags") or [],
                        "direction": it.get("direction") or "",
                        "color": it.get("color") or ""
                    } for it in items]
                }
                json_path = os.path.join(target_dir, "validated-selection.json")
                try:
                    with open(json_path, 'w', encoding='utf-8') as f:
                        json.dump(subset, f, ensure_ascii=False, indent=2)
                except Exception as e:
                    results.append({"jsonWrite": f"error: {e}"})

                return self._json(200, {
                    "ok": True,
                    "targetDir": target_dir_name,
                    "jsonFile": f"{target_dir_name}/validated-selection.json",
                    "results": results
                })

            except Exception as e:
                return self._json(500, {"ok": False, "error": str(e)})

        else:
            return self._json(404, {"status": "error", "message": "Route not found"})

    def _json(self, code, payload):
        self.send_response(code)
        self.send_header('Content-type', 'application/json; charset=utf-8')
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode('utf-8'))

def run_server(host="0.0.0.0", port=DEFAULT_PORT):
    """Démarre le serveur HTTP (bloquant)."""
    with socketserver.TCPServer((host, port), MyHandler) as httpd:
        print(f"Serving at http://{host}:{port}")
        httpd.serve_forever()

if __name__ == '__main__':
    run_server()