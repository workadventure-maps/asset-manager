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

# ---- Model and label configuration ----
print("Loading the CLIP vision model and processor...")
model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")

# Labels for color and orientation
color_labels = ["red", "blue", "green", "yellow", "brown", "black", "white", "beige", "grey", "dark blue", "purple", "orange", "pink", "dark green", "light blue", "cyan", "magenta", "lime", "teal"]
orientation_labels = ["front", "back", "left", "right", "up", "down"]

# Default similarity threshold
SIMILARITY_THRESHOLD = 0.9

# ---- Utility functions ----

def get_image_embedding(image_path):
    """Compute the embedding of an image."""
    try:
        image = Image.open(image_path).convert("RGB")
        inputs = processor(images=image, return_tensors="pt")
        with torch.no_grad():
            embedding = model.get_image_features(**inputs)
        return embedding.squeeze().numpy()
    except Exception as e:
        print(f"Error while creating the embedding for {image_path}: {e}")
        return None

def find_closest_color_name(rgb, color_names):
    """Find the closest color name for a given RGB value."""
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
    Find the most dominant color in an image, favoring vivid colors.
    """
    try:
        image = Image.open(image_path).convert("RGB")
        pixel_data = list(image.getdata())
        
        # More robust background filtering
        pixels_to_count = [p for p in pixel_data if p[0] + p[1] + p[2] < 750 and p[0] + p[1] + p[2] > 10]
        
        if not pixels_to_count:
            return "unknow"
            
        color_counts = Counter(pixels_to_count).most_common()
        
        # Split colors into two lists: neutral and non-neutral
        neutral_colors = ["white", "black", "grey", "beige"]
        non_neutral_colors = [c for c in color_labels if c not in neutral_colors]

        # Look for the first dominant non-neutral color
        for color_rgb, count in color_counts:
            label = find_closest_color_name(color_rgb, color_labels)
            if label in non_neutral_colors:
                return label

        # If no non-neutral color is found, return the most dominant neutral color
        for color_rgb, count in color_counts:
            label = find_closest_color_name(color_rgb, color_labels)
            if label in neutral_colors:
                return label

        return "unknow"
        
    except Exception as e:
        print(f"Error while classifying the color for {image_path}: {e}")
        return "unknow"

def get_average_color_hex(image_path):
    """
    Compute the average color of non-transparent pixels and return it in hex format.
    """
    try:
        image = Image.open(image_path).convert("RGB")
        pixel_data = list(image.getdata())
        
        # Filter out transparent, white or black background pixels
        pixels_to_count = [p for p in pixel_data if p[0] + p[1] + p[2] < 750 and p[0] + p[1] + p[2] > 10]

        if not pixels_to_count:
            return "#ffffff"  # Default to white if nothing significant is found

        avg_rgb = np.mean(pixels_to_count, axis=0).astype(int)
        
        # Convert to hexadecimal format
        hex_color = f"#{avg_rgb[0]:02x}{avg_rgb[1]:02x}{avg_rgb[2]:02x}"
        return hex_color
    except Exception as e:
        print(f"Error while computing the average color for {image_path}: {e}")
        return "#ffffff"

def classify_orientation(image_path, labels):
    """Classify the orientation of an image."""
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
        print(f"Error while classifying the orientation for {image_path}: {e}")
        return "unknow"

def trim_transparent_borders(input_dir, output_dir, fuzz='2%'):
    """
    Remove transparent borders from the PNG images in a directory.
    Requires ImageMagick.
    """
    print("Starting to trim transparent images...")
    try:
        im_command = "magick"
        if not shutil.which(im_command):
            im_command = "convert"
            if not shutil.which(im_command):
                raise FileNotFoundError("ImageMagick is not installed. Please install it (e.g. 'brew install imagemagick').")

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
                    print(f"  - Trimmed '{filename}' successfully.")
                except subprocess.CalledProcessError as e:
                    print(f"  - Error while trimming '{filename}': {e}")
                except Exception as e:
                    print(f"  - Unexpected error while trimming '{filename}': {e}")
    except FileNotFoundError as e:
        print(f"Error: {e}")
        return False
    
    print("Trimming finished.")
    return True

def generate_json_file(collection_data):
    """
    Generate a JSON file with the asset collection data.
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
    print(f"\nThe JSON file was successfully generated in '{output_path}'.")

# ---- Main script entry point ----
def main():
    # ---- 1. Prepare data from the 'model' folder ----
    model_dir = "model"
    model_embeddings = {}
    tags_mapping = {}

    if not os.path.exists(model_dir):
        print(f"Error: The folder '{model_dir}' does not exist. Create it and put your reference images in it.")
        exit()
    
    print(f"Preparing data from the '{model_dir}' folder...")
    embeddings_by_object = {}
    for filename in os.listdir(model_dir):
        if filename.endswith(('.png', '.jpg', '.jpeg')):
            file_path = os.path.join(model_dir, filename)
            try:
                if '-' in os.path.splitext(filename)[0]:
                    object_name = os.path.splitext(filename)[0].split('-')[0]
                else:
                    object_name = os.path.splitext(filename)[0]
                    print(f"  - Warning: The file '{filename}' does not follow the 'object_name-tags' naming convention. The object name will be taken as '{object_name}'.")

                if object_name not in tags_mapping:
                    tags_mapping[object_name] = [object_name.replace('_', ' ').title()]

                embedding = get_image_embedding(file_path)
                if embedding is not None:
                    if object_name not in embeddings_by_object:
                        embeddings_by_object[object_name] = []
                    embeddings_by_object[object_name].append(embedding)
            except Exception as e:
                print(f"  - Unexpected error while processing the model image '{filename}': {e}")
    
    for object_name, embeddings in embeddings_by_object.items():
        model_embeddings[object_name] = np.mean(embeddings, axis=0)
        print(f"  - Computed mean vector for object '{object_name}'.")

    if not model_embeddings:
        print("No valid model image found. The script cannot continue.")
        exit()

    # ---- 2. Process images from the 'src' folder ----
    src_dir = "src"
    dist_dir = "dist"
    unknow_dir = "unknow"
    trimmed_src_dir = "src_trimmed"
    json_collection_data = []

    if not os.path.exists(src_dir):
        print(f"Error: The folder '{src_dir}' does not exist. Create it and put the images to process in it.")
        exit()

    if os.path.exists(dist_dir):
        shutil.rmtree(dist_dir)
    os.makedirs(dist_dir)
    print(f"The destination folder '{dist_dir}' has been emptied.")

    if os.path.exists(unknow_dir):
        shutil.rmtree(unknow_dir)
    os.makedirs(unknow_dir)
    print(f"The folder '{unknow_dir}' has been emptied.")

    if os.path.exists(trimmed_src_dir):
        shutil.rmtree(trimmed_src_dir)
    if trim_transparent_borders(src_dir, trimmed_src_dir):
        src_dir_to_process = trimmed_src_dir
    else:
        src_dir_to_process = src_dir
        print("Trimming failed. The script will continue with the original images.")

    print(f"\nProcessing images from the '{src_dir_to_process}' folder...")
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
                    print(f"Warning: '{filename}' has no sufficient match. Moved to '{unknow_dir}'. Similarity: {max_similarity:.2f}")
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
                    print(f"'{filename}' matches '{best_match_object}' with a similarity of {max_similarity:.2f}. Renaming...")
                    final_name = f"{best_match_object.replace(' ', '_')}-{dominant_color.replace(' ', '_')}-{orientation}{new_extension}"
                    final_path = os.path.join(dist_dir, final_name)
                    i = 1
                    while os.path.exists(final_path):
                        name_without_ext = f"{best_match_object.replace(' ', '_')}-{dominant_color.replace(' ', '_')}-{orientation}"
                        final_name = f"{name_without_ext}-{i}{new_extension}"
                        final_path = os.path.join(dist_dir, final_name)
                        i += 1
                    print(f"    - Renaming to '{final_name}'.")
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
                print(f"Error while processing '{filename}': {e}")

    generate_json_file(json_collection_data)
    print("\nOperation finished.")

# ---- 3. Start the advanced web server ----
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
            print(f"The file '{ASSET_JSON_FILE}' was updated successfully.")
            
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))
            print(f"Error while updating the JSON file: {e}")

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
            print(f"\nServer started on port {PORT}.")
            webbrowser.open(f"http://localhost:{PORT}")
            print(f"Open your browser and go to: http://localhost:{PORT}")
            print("To stop the server, press Ctrl+C.")
            httpd.serve_forever()
    except OSError as e:
        if "Address already in use" in str(e):
            print(f"\nError: Port {PORT} is already in use. Please free this port or choose another one (for example, 8001).")
        else:
            print(f"An error occurred while starting the server: {e}")