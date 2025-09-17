import os
import shutil
import subprocess
from PIL import Image
import torch
from transformers import CLIPProcessor, CLIPModel
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity
from collections import Counter
from scipy.spatial.distance import cdist
import json
import re
import http.server
import socketserver
import webbrowser
import urllib.parse

# ---- Configuration du modèle et des étiquettes ----
print("Chargement du modèle de vision CLIP et du processeur...")
model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")

# Étiquettes pour la couleur et l'orientation
color_labels = ["red", "blue", "green", "yellow", "brown", "black", "white", "beige", "grey", "dark blue", "purple", "orange", "pink", "dark green", "light blue", "cyan", "magenta", "lime", "teal"]
orientation_labels = ["front", "back", "left", "right", "up", "down"]

# Seuil de similarité par défaut
SIMILARITY_THRESHOLD = 0.9

# ---- Fonctions utilitaires ----

def get_image_embedding(image_path):
    """Calcule l'embedding d'une image."""
    try:
        image = Image.open(image_path).convert("RGB")
        inputs = processor(images=image, return_tensors="pt")
        with torch.no_grad():
            embedding = model.get_image_features(**inputs)
        return embedding.squeeze().numpy()
    except Exception as e:
        print(f"Erreur lors de la création de l'embedding pour {image_path}: {e}")
        return None

def find_closest_color_name(rgb, color_names):
    """Trouve le nom de couleur le plus proche pour une valeur RGB donnée."""
    color_map = {
        "red": [255, 0, 0], "blue": [0, 0, 255], "green": [0, 128, 0], "yellow": [255, 255, 0],
        "brown": [139, 69, 19], "black": [0, 0, 0], "white": [255, 255, 255], "beige": [245, 245, 220],
        "grey": [128, 128, 128], "dark blue": [0, 0, 139], "purple": [128, 0, 128], "orange": [255, 165, 0],
        "pink": [255, 192, 203], "dark green": [0, 100, 0], "light blue": [173, 216, 230], "cyan": [0, 255, 255],
        "magenta": [255, 0, 255], "lime": [0, 255, 0], "teal": [0, 128, 128]
    }
    
    valid_colors_rgb = [color_map[name] for name in color_names if name in color_map]
    valid_color_names = [name for name in color_names if name in color_map]
    
    if not valid_colors_rgb:
        return "unknow"
        
    distances = cdist([rgb], valid_colors_rgb, 'euclidean')
    closest_index = distances.argmin()
    
    return valid_color_names[closest_index]

def get_dominant_color_label(image_path, color_labels):
    """
    Trouve la couleur la plus dominante dans une image en privilégiant les couleurs vives.
    """
    try:
        image = Image.open(image_path).convert("RGB")
        pixel_data = list(image.getdata())
        
        # Filtrage plus robuste pour les fonds
        pixels_to_count = [p for p in pixel_data if p[0] + p[1] + p[2] < 750 and p[0] + p[1] + p[2] > 10]
        
        if not pixels_to_count:
            return "unknow"
            
        color_counts = Counter(pixels_to_count).most_common()
        
        # Séparer les couleurs en deux listes: neutres et non-neutres
        neutral_colors = ["white", "black", "grey", "beige"]
        non_neutral_colors = [c for c in color_labels if c not in neutral_colors]

        # Chercher la première couleur dominante non-neutre
        for color_rgb, count in color_counts:
            label = find_closest_color_name(color_rgb, color_labels)
            if label in non_neutral_colors:
                return label

        # Si aucune couleur non-neutre n'est trouvée, retourner la couleur neutre la plus dominante
        for color_rgb, count in color_counts:
            label = find_closest_color_name(color_rgb, color_labels)
            if label in neutral_colors:
                return label

        return "unknow"
        
    except Exception as e:
        print(f"Erreur lors de la classification de la couleur pour {image_path}: {e}")
        return "unknow"

def get_average_color_hex(image_path):
    """
    Calcule la couleur moyenne des pixels non-transparents et la retourne en format hex.
    """
    try:
        image = Image.open(image_path).convert("RGB")
        pixel_data = list(image.getdata())
        
        # Filtrage des pixels de fond transparents, blancs ou noirs
        pixels_to_count = [p for p in pixel_data if p[0] + p[1] + p[2] < 750 and p[0] + p[1] + p[2] > 10]

        if not pixels_to_count:
            return "#ffffff"  # Par défaut, blanc si rien de significatif n'est trouvé

        avg_rgb = np.mean(pixels_to_count, axis=0).astype(int)
        
        # Conversion en format hexadécimal
        hex_color = f"#{avg_rgb[0]:02x}{avg_rgb[1]:02x}{avg_rgb[2]:02x}"
        return hex_color
    except Exception as e:
        print(f"Erreur lors du calcul de la couleur moyenne pour {image_path}: {e}")
        return "#ffffff"

def classify_orientation(image_path, labels):
    """Classifie l'orientation d'une image."""
    try:
        image = Image.open(image_path).convert("RGB")
        prompts = [f"a pixel art object viewed from the {label}." for label in labels]
        inputs = processor(text=prompts, images=image, return_tensors="pt", padding=True)
        with torch.no_grad():
            outputs = model(**inputs)
        logits = outputs.logits_per_image
        probs = logits.softmax(dim=1)
        
        best_label_index = probs.argmax()
        best_label = labels[best_label_index]
        return best_label
    except Exception as e:
        print(f"Erreur lors de la classification de l'orientation pour {image_path}: {e}")
        return "unknow"

def trim_transparent_borders(input_dir, output_dir, fuzz='2%'):
    """
    Supprime les bords transparents des images PNG d'un répertoire.
    Nécessite ImageMagick.
    """
    print("Début du rognage des images transparentes...")
    try:
        im_command = "magick"
        if not shutil.which(im_command):
            im_command = "convert"
            if not shutil.which(im_command):
                raise FileNotFoundError("ImageMagick n'est pas installé. Veuillez l'installer (ex. : 'brew install imagemagick').")

        if not os.path.exists(output_dir):
            os.makedirs(output_dir)

        for filename in os.listdir(input_dir):
            if filename.endswith(('.png', '.PNG')):
                src_path = os.path.join(input_dir, filename)
                dest_path = os.path.join(output_dir, filename)

                try:
                    subprocess.run(
                        [im_command, src_path, "-bordercolor", "none", "-border", "1", "-alpha", "set", "-fuzz", fuzz, "-trim", "+repage", dest_path],
                        check=True
                    )
                    print(f"  - Rogneage réussi pour '{filename}'.")
                except subprocess.CalledProcessError as e:
                    print(f"  - Erreur lors du rognage de '{filename}': {e}")
                except Exception as e:
                    print(f"  - Erreur inattendue lors du rognage de '{filename}': {e}")
    except FileNotFoundError as e:
        print(f"Erreur: {e}")
        return False
    
    print("Rogneage terminé.")
    return True

def generate_json_file(collection_data):
    """
    Génère un fichier JSON avec les données de la collection d'assets.
    """
    json_header = {
        "collectionName": "LimeZu Modern Office",
        "tags": [
            "LimeZu",
            "Modern",
            "Office"
        ],
        "collection": []
    }
    
    for item in collection_data:
        json_header["collection"].append(item)
    
    output_path = "assets_list.json"
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(json_header, f, indent=4)
    print(f"\nLe fichier JSON a été généré avec succès dans '{output_path}'.")

# ---- Point d'entrée principal du script ----
def main():
    # ---- 1. Préparation des données du dossier 'model' ----
    model_dir = "model"
    model_embeddings = {}
    tags_mapping = {}

    if not os.path.exists(model_dir):
        print(f"Erreur : Le dossier '{model_dir}' n'existe pas. Créez-le et placez vos images de référence dedans.")
        exit()
    
    print(f"Préparation des données du dossier '{model_dir}'...")
    embeddings_by_object = {}
    for filename in os.listdir(model_dir):
        if filename.endswith(('.png', '.jpg', '.jpeg')):
            file_path = os.path.join(model_dir, filename)
            try:
                if '-' in os.path.splitext(filename)[0]:
                    object_name = os.path.splitext(filename)[0].split('-')[0]
                else:
                    object_name = os.path.splitext(filename)[0]
                    print(f"  - Avertissement : Le fichier '{filename}' ne suit pas la convention de nommage 'nom_objet-tags'. Le nom de l'objet sera considéré comme '{object_name}'.")

                if object_name not in tags_mapping:
                    tags_mapping[object_name] = [object_name.replace('_', ' ').title()]

                embedding = get_image_embedding(file_path)
                if embedding is not None:
                    if object_name not in embeddings_by_object:
                        embeddings_by_object[object_name] = []
                    embeddings_by_object[object_name].append(embedding)
            except Exception as e:
                print(f"  - Erreur inattendue lors du traitement de l'image modèle '{filename}': {e}")
    
    for object_name, embeddings in embeddings_by_object.items():
        model_embeddings[object_name] = np.mean(embeddings, axis=0)
        print(f"  - Vecteur moyen calculé pour l'objet '{object_name}'.")

    if not model_embeddings:
        print("Aucune image modèle valide trouvée. Le script ne peut pas continuer.")
        exit()

    # ---- 2. Traitement des images du dossier 'src' ----
    src_dir = "src"
    dist_dir = "dist"
    unknow_dir = "unknow"
    trimmed_src_dir = "src_trimmed"
    json_collection_data = []

    if not os.path.exists(src_dir):
        print(f"Erreur : Le dossier '{src_dir}' n'existe pas. Créez-le et placez vos images à traiter dedans.")
        exit()

    if os.path.exists(dist_dir):
        shutil.rmtree(dist_dir)
    os.makedirs(dist_dir)
    print(f"Le dossier de destination '{dist_dir}' a été vidé.")

    if os.path.exists(unknow_dir):
        shutil.rmtree(unknow_dir)
    os.makedirs(unknow_dir)
    print(f"Le dossier '{unknow_dir}' a été vidé.")

    if os.path.exists(trimmed_src_dir):
        shutil.rmtree(trimmed_src_dir)
    if trim_transparent_borders(src_dir, trimmed_src_dir):
        src_dir_to_process = trimmed_src_dir
    else:
        src_dir_to_process = src_dir
        print("Le rognage a échoué. Le script continuera avec les images originales.")

    print(f"\nTraitement des images du dossier '{src_dir_to_process}'...")
    for filename in os.listdir(src_dir_to_process):
        if filename.endswith(('.png', '.jpg', '.jpeg')):
            source_path = os.path.join(src_dir_to_process, filename)
            
            try:
                source_embedding = get_image_embedding(source_path)
                if source_embedding is None:
                    continue

                best_match_object = None
                max_similarity = 0
                
                for object_name, model_emb in model_embeddings.items():
                    similarity = cosine_similarity([source_embedding], [model_emb])[0][0]
                    
                    if similarity > max_similarity:
                        max_similarity = similarity
                        best_match_object = object_name
                
                dominant_color = get_dominant_color_label(source_path, color_labels)
                orientation = classify_orientation(source_path, orientation_labels)
                
                new_extension = '.png'
                
                if max_similarity < SIMILARITY_THRESHOLD:
                    print(f"Avertissement : '{filename}' n'a pas de match suffisant. Déplacé vers '{unknow_dir}'. Similarité: {max_similarity:.2f}")
                    final_name = f"unknow-{dominant_color}-{orientation}{new_extension}"
                    final_path = os.path.join(unknow_dir, final_name)
                    i = 1
                    while os.path.exists(final_path):
                        name_without_ext = f"unknow-{dominant_color}-{orientation}"
                        final_name = f"{name_without_ext}-{i}{new_extension}"
                        final_path = os.path.join(unknow_dir, final_name)
                        i += 1
                    shutil.move(source_path, final_path)
                else:
                    print(f"'{filename}' correspond à '{best_match_object}' avec une similarité de {max_similarity:.2f}. Renommage...")
                    final_name = f"{best_match_object.replace(' ', '_')}-{dominant_color.replace(' ', '_')}-{orientation}{new_extension}"
                    final_path = os.path.join(dist_dir, final_name)
                    i = 1
                    while os.path.exists(final_path):
                        name_without_ext = f"{best_match_object.replace(' ', '_')}-{dominant_color.replace(' ', '_')}-{orientation}"
                        final_name = f"{name_without_ext}-{i}{new_extension}"
                        final_path = os.path.join(dist_dir, final_name)
                        i += 1
                    print(f"    - Renommage en '{final_name}'.")
                    shutil.move(source_path, final_path)
                    
                    hex_color = get_average_color_hex(final_path)
                    image_tags = tags_mapping.get(best_match_object, ["unknow"])
                    json_name = best_match_object.replace('_', ' ').title()
                    
                    json_item = {
                        "name": json_name,
                        "tags": image_tags,
                        "imagePath": f"dist/{final_name}",
                        "direction": orientation,
                        "color": hex_color
                    }
                    json_collection_data.append(json_item)

            except Exception as e:
                print(f"Erreur lors du traitement de '{filename}': {e}")

    generate_json_file(json_collection_data)
    print("\nOpération terminée.")

# ---- 3. Lancer le serveur web avancé ----
PORT = 8000
ASSET_JSON_FILE = "assets_list.json"

class MyHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        
        try:
            new_data = json.loads(post_data.decode('utf-8'))
            
            with open(ASSET_JSON_FILE, 'w', encoding='utf-8') as f:
                json.dump(new_data, f, indent=4)
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "success"}).encode('utf-8'))
            print(f"Le fichier '{ASSET_JSON_FILE}' a été mis à jour avec succès.")
            
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))
            print(f"Erreur lors de la mise à jour du fichier JSON : {e}")

    def do_GET(self):
        # Decode the URL path to handle characters like '%20'
        decoded_path = urllib.parse.unquote(self.path)

        if decoded_path == '/':
            decoded_path = '/index.html'
        
        try:
            self.send_response(200)
            
            # Use the decoded path to check file extensions and serve files
            if decoded_path.endswith(".html"):
                self.send_header('Content-type', 'text/html')
            elif decoded_path.endswith(".js"):
                self.send_header('Content-type', 'application/javascript')
            elif decoded_path.endswith(".css"):
                self.send_header('Content-type', 'text/css')
            elif decoded_path.endswith(".json"):
                self.send_header('Content-type', 'application/json')
            elif decoded_path.endswith((".png", ".jpg", ".jpeg")):
                self.send_header('Content-type', 'image/png')
            
            self.end_headers()

            with open(os.getcwd() + decoded_path, 'rb') as file:
                self.wfile.write(file.read())
        
        except FileNotFoundError:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"404 Not Found")

if __name__ == "__main__":
    main()
    try:
        with socketserver.TCPServer(("", PORT), MyHandler) as httpd:
            print(f"\nServeur démarré sur le port {PORT}.")
            webbrowser.open(f"http://localhost:{PORT}")
            print("Ouvrez votre navigateur et allez à l'adresse : http://localhost:{PORT}")
            print("Pour arrêter le serveur, appuyez sur Ctrl+C.")
            httpd.serve_forever()
    except OSError as e:
        if "Address already in use" in str(e):
            print(f"\nErreur : Le port {PORT} est déjà utilisé. Veuillez libérer ce port ou choisir un autre port (par exemple, 8001).")
        else:
            print(f"Une erreur s'est produite lors du démarrage du serveur : {e}")