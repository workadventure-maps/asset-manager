import json

# Définissez les familles de couleurs et leurs codes RVB
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

# Fonction pour convertir un code hexadécimal en valeurs RVB
def hex_to_rgb(hex_code):
    hex_code = hex_code.lstrip('#')
    return tuple(int(hex_code[i:i+2], 16) for i in (0, 2, 4))

# Fonction pour trouver la famille de couleur à laquelle un code RVB appartient
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
                    rgb_color = hex_to_rgb(hex_color)
                    
                    family, new_hex_code = find_color_family(rgb_color)
                    
                    if family and new_hex_code:
                        print(f"Asset '{asset['name']}': Couleur '{hex_color}' classée comme '{family}', mise à jour en '{new_hex_code}'")
                        asset["color"] = new_hex_code
                    else:
                        print(f"Asset '{asset['name']}': Couleur '{hex_color}' n'a pas pu être classée dans une famille. Laissez telle quelle.")

        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4)
        
        print("\nLe fichier JSON a été mis à jour avec les nouvelles couleurs de famille.")

    except FileNotFoundError:
        print(f"Erreur : Le fichier '{file_path}' n'a pas été trouvé.")
    except Exception as e:
        print(f"Une erreur est survenue : {e}")

if __name__ == "__main__":
    json_file_path = "assets_list.json"
    update_json_colors(json_file_path)