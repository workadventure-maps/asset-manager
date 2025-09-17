import http.server
import socketserver
import json
import os
import urllib.parse

PORT = 8001
ASSETS_FILE = 'assets_list.json'

# --- Fonctions pour la mise à jour des couleurs (intégrées ici) ---
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
    "gold": {"hex": "#FFD700", "min_rgb": [200, 180, 0], "max_rgb": [255, 220, 50]},
    "green": {"hex": "#00FF00", "min_rgb": [0, 200, 0], "max_rgb": [100, 255, 100]},
    "lime": {"hex": "#00FF00", "min_rgb": [0, 200, 0], "max_rgb": [100, 255, 100]},
    "forest_green": {"hex": "#228B22", "min_rgb": [30, 130, 30], "max_rgb": [70, 150, 70]},
    "olive": {"hex": "#808000", "min_rgb": [100, 100, 0], "max_rgb": [150, 150, 50]},
    "brown": {"hex": "#A52A2A", "min_rgb": [150, 40, 40], "max_rgb": [180, 80, 80]},
    "chocolate": {"hex": "#D2691E", "min_rgb": [180, 80, 20], "max_rgb": [220, 120, 60]},
    "saddlebrown": {"hex": "#8B4513", "min_rgb": [120, 60, 20], "max_rgb": [150, 80, 40]},
    "orange": {"hex": "#FFA500", "min_rgb": [250, 160, 0], "max_rgb": [255, 180, 50]},
    "purple": {"hex": "#800080", "min_rgb": [100, 0, 100], "max_rgb": [150, 50, 150]},
    "magenta": {"hex": "#FF00FF", "min_rgb": [200, 0, 200], "max_rgb": [255, 100, 255]},
    "fuchsia": {"hex": "#FF00FF", "min_rgb": [200, 0, 200], "max_rgb": [255, 100, 255]},
    "pink": {"hex": "#FFC0CB", "min_rgb": [250, 180, 200], "max_rgb": [255, 200, 220]},
    "hot_pink": {"hex": "#FF69B4", "min_rgb": [250, 100, 170], "max_rgb": [255, 120, 200]},
    "grey": {"hex": "#808080", "min_rgb": [120, 120, 120], "max_rgb": [150, 150, 150]},
    "dark_grey": {"hex": "#A9A9A9", "min_rgb": [160, 160, 160], "max_rgb": [180, 180, 180]},
    "light_grey": {"hex": "#D3D3D3", "min_rgb": [200, 200, 200], "max_rgb": [220, 220, 220]},
    "black": {"hex": "#000000", "min_rgb": [0, 0, 0], "max_rgb": [50, 50, 50]},
    "white": {"hex": "#FFFFFF", "min_rgb": [240, 240, 240], "max_rgb": [255, 255, 255]},
    "beige": {"hex": "#F5F5DC", "min_rgb": [240, 240, 210], "max_rgb": [255, 255, 230]},
    "tan": {"hex": "#D2B48C", "min_rgb": [200, 170, 130], "max_rgb": [220, 190, 150]}
}

def hex_to_rgb(hex_color):
    hex_color = hex_color.lstrip('#')
    if len(hex_color) == 3:
        hex_color = ''.join([c*2 for c in hex_color])
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))

def find_color_family(rgb_color):
    r, g, b = rgb_color
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
                    rgb_color = hex_to_rgb(hex_color)
                    
                    family, new_hex_code = find_color_family(rgb_color)
                    
                    if family and new_hex_code:
                        print(f"Asset '{asset['name']}': Couleur '{hex_color}' classée comme '{family}', mise à jour en '{new_hex_code}'")
                        asset["color"] = new_hex_code
                    else:
                        print(f"Asset '{asset['name']}': Couleur '{hex_color}' n'a pas pu être classée dans une famille. Laissez telle quelle.")
                        
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4)
        
        return True, "Le fichier JSON a été mis à jour avec les nouvelles couleurs de famille."
    except FileNotFoundError:
        return False, f"Erreur : Le fichier '{file_path}' n'a pas été trouvé."
    except Exception as e:
        return False, f"Une erreur est survenue : {e}"

# --- Classes de gestion des requêtes ---
class MyHandler(http.server.SimpleHTTPRequestHandler):
    ASSETS_FILE = 'assets_list.json'

    def do_GET(self):
        if self.path == '/':
            self.path = '/index.html'
        
        super().do_GET()

    def do_POST(self):
        if self.path == '/update_assets':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            try:
                data_to_update = json.loads(post_data.decode('utf-8'))
                
                with open(ASSETS_FILE, 'r+', encoding='utf-8') as f:
                    file_data = json.load(f)
                    for asset in file_data['collection']:
                        if 'imagePath' in asset and asset['imagePath'] in data_to_update:
                            updated_info = data_to_update[asset['imagePath']]
                            asset.update(updated_info)
                    
                    f.seek(0)
                    json.dump(file_data, f, indent=4)
                    f.truncate()
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "success", "message": "Fichier JSON mis à jour."}).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))

        elif self.path == '/update_colors':
            success, message = update_json_colors(ASSETS_FILE)
            if success:
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "success", "message": message}).encode('utf-8'))
            else:
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "message": message}).encode('utf-8'))

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

def run_server():
    try:
        with socketserver.TCPServer(("", PORT), MyHandler) as httpd:
            print("Serveur démarré sur le port", PORT)
            httpd.serve_forever()
    except OSError as e:
        print(f"Erreur: {e}")
        print(f"Le port {PORT} est peut-être déjà utilisé. Veuillez arrêter le processus qui l'utilise ou choisir un autre port.")
        
if __name__ == "__main__":
    run_server()