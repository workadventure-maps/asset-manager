
# Assets Collection Manager

Ce projet permet de **scanner des images**, de les organiser avec des métadonnées (nom, direction, couleur, tags),
de **nettoyer** les dossiers d’images, et de les gérer via une **interface web**.

---

## 📂 Arborescence principale

```
.
├── model/              # Contient les modèles IA ou fichiers associés (ex: CLIP)
│   ├── clip/           # (optionnel) modèle CLIP si tu veux activer la reconnaissance automatique
│   └── ...             # autres modèles ou checkpoints
├── src/                # Dossier source où déposer les nouvelles images (non encore traitées)
├── dist/               # Dossier de sortie : contient les images renommées et organisées
├── unknow/             # Images non classées (ex: direction introuvable)
├── assets_list.json    # Base de données JSON de la collection (générée par le scan)
├── main.py             # Point d'entrée principal (orchestrateur: clean/scan/serve/all)
├── server.py           # Serveur web (routes JSON, update_colors, validate_selection)
├── image_processor.py  # Scan/traitement (lazy-load modèle, couleur moyenne, renommage)
├── update_colors.py    # Utilitaire pour mettre à jour les couleurs du JSON
├── clean-images.py     # Utilitaire de nettoyage (doublons, temporaires, etc.)
├── index.html          # Interface utilisateur
├── app.js              # Logique côté client
├── app.css             # Styles
```

---

## 📦 Le dossier `model/`

Le dossier `model/` est prévu pour stocker les **modèles IA** utilisés par le pipeline.  

### 1. Reconnaissance via CLIP (optionnel)
- Si tu actives la partie **CLIP** dans `image_processor.py`, celui-ci ira chercher un modèle dans `model/clip/`.
- Typiquement, Hugging Face télécharge le modèle `openai/clip-vit-base-patch32` et le met en cache.  
  Tu peux soit :
  - laisser Hugging Face gérer le cache (dans `~/.cache/huggingface/`),  
  - soit copier manuellement le modèle dans `model/clip/` pour un usage offline.

### 2. Autres modèles
- Tu peux stocker ici d’autres modèles ou fichiers (par ex. classification couleurs avancée, détection d’objets, etc.)
- La logique dans `image_processor.py` peut être adaptée pour charger ces fichiers.

### 3. Nomenclature attendue
- Pour CLIP, le répertoire attendu ressemble à ceci :
  ```
  model/clip/
  ├── config.json
  ├── preprocessor_config.json
  ├── pytorch_model.bin
  └── vocab.json
  ```
- Pour d’autres modèles, adopte la convention :
  ```
  model/<nom_du_modele>/
  ├── fichiers_model.bin / config.json / ...
  ```

---

## 🐍 Scripts Python

### `main.py` (orchestrateur)
Gère tout le workflow avec des **modes** :
- `--mode serve` : lance **uniquement** le serveur web (pas de scan, pas de clean)
- `--mode scan` : scanne les images (`src/` → `dist/` + maj `assets_list.json`)
- `--mode clean` : exécute `clean-images.py` (nettoyage des dossiers `src/`, `dist/`, `unknow/`)
- `--mode clean-scan` : **clean puis scan** (utile après ajout massif d’images)
- `--mode all` : **clean + scan puis serve** (workflow complet clé-en-main)

Options communes :
- `--model-dir` (par défaut `model/`)
- `--src-dir` (par défaut `src/`)
- `--dist-dir` (par défaut `dist/`)
- `--unknow-dir` (par défaut `unknow/`)
- `--host` (par défaut `0.0.0.0`), `--port` (par défaut `8000`)

Exemples :
```bash
# Juste servir l'app, sans rescanner ni nettoyer
python main.py --mode serve

# Nettoyer les dossiers puis scanner
python main.py --mode clean-scan

# Tout faire (nettoyage + scan + serveur)
python main.py --mode all
```

> Implémentation : `main.py` tente d'**importer** `clean_images` (si ton fichier s'appelle `clean_images.py`)
> et d'appeler `main()`, `run()` ou `clean()`. S'il ne trouve pas de fonction, il exécute `clean-images.py`
> en **sous-processus** avec les arguments `--src`, `--dist`, `--unknow` (si le script les supporte).

### `server.py`
Serveur HTTP minimaliste (`http.server`) avec CORS :
- `POST /` → met à jour `assets_list.json`
- `POST /update_colors` → re-mappe les couleurs dans le JSON
- `POST /validate_selection` → copie/renomme dans `validate elements/` + JSON filtré

Expose `run_server(host, port)` (utilisé par `main.py`).

### `image_processor.py`
Pipeline de traitement :
- Parcours `src/` → déduit **direction** (front/back/left/right/up/down) d'après le nom
- Estime la **couleur dominante** (Pillow) puis assigne la **famille** la plus proche
- Renomme : `name-color-direction-index.png` et copie vers `dist/` (ou `unknow/` si direction inconnue)
- Re-scanne `dist/` pour régénérer la collection
- Écrit `assets_list.json`

Le **modèle** (CLIP) est en **lazy-load** et n'est pas utilisé par défaut (prêt si tu veux enrichir les tags).

### `update_colors.py`
Utilitaire pour re-catégoriser les couleurs déjà présentes dans `assets_list.json`.

### `clean-images.py`
Nettoie les dossiers d’images (suppression de doublons, temporaires, etc.).  
Peut être lancé **directement** ou via `main.py --mode clean` / `--mode clean-scan` / `--mode all`.

---

## 🌐 Frontend

### `index.html` / `app.js` / `app.css`
- Affiche la collection, filtres (nom/tags/direction/couleur), **infinite scroll**
- Édition par carte, **édition en masse** via modale
- Compteurs par option (tags, couleurs, directions)
- **Toasts** de notifications empilés
- Bouton **Validate Selection** → envoie la sélection au serveur (copie/rename) et télécharge un JSON filtré côté client
- L’**accessibilité** est améliorée (ARIA, focus), et la performance optimisée (DOM minimal diffs)

---

## 🚀 Workflow recommandé

1. **Nettoyer** (optionnel) :
   ```bash
   python main.py --mode clean
   ```

2. **Scanner** pour générer/mettre à jour `assets_list.json` :
   ```bash
   python main.py --mode scan
   ```

3. **Servir** l'application web **sans rescanner** :
   ```bash
   python main.py --mode serve
   ```

4. **Tout-en-un** :
   ```bash
   python main.py --mode all
   ```

Ouvrir `index.html` dans le navigateur pour utiliser l’interface.
