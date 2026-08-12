# Documentation — Assets Collection Manager

Documentation technique complète. Pour une vue d'ensemble rapide, voir [README.md](README.md).

---

## Table des matières

1. [Architecture](#1-architecture)
2. [Installation & exécution](#2-installation--exécution)
3. [Modèle de données](#3-modèle-de-données)
4. [API du serveur](#4-api-du-serveur)
5. [Page Index](#5-page-index)
6. [Page Collections](#6-page-collections)
7. [Page Add Assets](#7-page-add-assets)
8. [Page Align](#8-page-align)
9. [Pipeline de scan](#9-pipeline-de-scan)
10. [Persistance & stockage local](#10-persistance--stockage-local)
11. [Conventions & couleurs](#11-conventions--couleurs)
12. [Dépannage](#12-dépannage)

---

## 1. Architecture

Application **100 % locale** : un serveur HTTP Python minimal (`http.server`) sert à la fois
les fichiers statiques (HTML/CSS/JS, images) et une petite API JSON. Le front est en JavaScript
vanilla (pas de build, pas de framework).

```
Navigateur  ──HTTP──►  server.py  ──►  fichiers (dist/, validated/, assets_list.json)
   │  pages statiques (index.html, align.html, …)
   └─ fetch() ──► routes API (POST JSON)
```

Composants :

- **`main.py`** — point d'entrée CLI ; orchestre clean / scan / serve.
- **`server.py`** — `Handler` (sous-classe de `SimpleHTTPRequestHandler`) : CORS, routes
  "jolies" en GET, routes API en POST, `allow_reuse_address` pour relancer sans attendre.
- **`image_processor.py`** — scan, détection direction/couleur, dates, helpers de grille 32px.
- **`clean-images.py`** — nettoyage des dossiers d'images.
- **Front** — `index.html`/`app.js`/`app.css` + pages autonomes (`align.html`,
  `add_assets.html`, `collection_list.html`, `collisions.html`) partageant `topbar.css`.

---

## 2. Installation & exécution

```bash
python3 --version          # 3.9+ recommandé
pip install pillow         # optionnel (couleur au scan + traitement d'images)

python3 main.py --mode serve          # serveur seul (http://localhost:8000)
python3 main.py --mode scan           # scan src/ → dist/ + JSON
python3 main.py --mode all            # clean + scan + serve
```

Options CLI : `--mode {serve,scan,clean,clean-scan,all}`, `--src-dir`, `--dist-dir`,
`--unknow-dir`, `--model-dir`, `--host` (défaut `0.0.0.0`), `--port` (défaut `8000`).

**Règle d'or** : un changement dans `server.py` / `image_processor.py` n'est pris en compte
qu'après **redémarrage du serveur**. Un changement front ne nécessite qu'un **hard refresh**
navigateur (le serveur n'envoie pas d'en-tête anti-cache, le CSS/JS reste donc en cache tant
qu'on ne force pas le rechargement).

---

## 3. Modèle de données

`assets_list.json` à la racine = **collection par défaut** chargée par l'Index.

```jsonc
{
  "collectionName": "Assets",        // titre de la collection
  "tags": ["Furniture"],             // tags globaux de la collection
  "collection": [ /* assets */ ]
}
```

### Champs d'un asset

| Champ | Type | Description |
|-------|------|-------------|
| `imagePath` | string | Chemin relatif servi par le serveur (ex. `dist/chair-front-1.png`) |
| `name` | string | Nom lisible (utilisé par le filtre Name) |
| `tags` | string[] | Tags de l'asset |
| `direction` | string | `front`, `back`, `left`, `right`, `up`, `down`, `unknow` |
| `color` | string | Couleur principale en hex (`#RRGGBB`) |
| `secondaryColor` | string | Couleur secondaire (hex, optionnelle) |
| `category` | string | Catégorie (liste prédéfinie, voir §11) |
| `dateAdded` | string | Date d'ajout ISO 8601 (tamponnée à la création/au scan) |
| `dateModified` | string | Date de dernière modification ISO 8601 (vide si jamais modifié) |

Notes :
- `dateAdded` est **rétro-rempli** à l'ouverture si absent, puis persisté.
- `dateModified` est mis à jour à chaque édition de champ (édition simple ou en masse).
- Au re-scan, les dates existantes sont **préservées** (fusion avec l'ancien JSON).

---

## 4. API du serveur

Toutes les réponses sont en JSON. CORS ouvert (`*`). Codes d'erreur usuels : `400` (entrée
invalide), `404` (introuvable), `409` (conflit), `500` (erreur serveur).

### Routes GET (pages + listing)

| Route | Effet |
|-------|-------|
| `/` | `index.html` |
| `/collection-list`, `/collections` | `collection_list.html` |
| `/add-assets` | `add_assets.html` |
| `/align` | `align.html` |
| `/collisions` | `collisions.html` |
| `/list_collections` | JSON : `{ collections: [{ dir, collectionName, tags, count, thumb }] }` |

### Routes POST (API)

| Route | Corps attendu | Effet |
|-------|---------------|-------|
| `/` | objet collection complet | Écrase `assets_list.json` (sauvegarde de l'Index) |
| `/validate_selection` | `{ dir, items:[{imagePath,newFilename}], json }` | Crée `validated/<dir>/` (images à plat + `assets_list.json`). **409** si le dossier existe. Écrit `imageBase` dans le JSON. |
| `/use_as_default` | `{ dir }` | Copie un pack de `validated/<dir>` vers `assets_list.json` racine, chemins réécrits en `validated/<dir>/<fichier>` |
| `/save_image` | `{ path, dataUrl }` | Écrit un PNG (base64) à un chemin relatif du projet (utilisé par Align) |
| `/append_asset` | `{ asset }` | Ajoute une entrée d'asset à `assets_list.json` racine (duplication Align) |
| `/upload_files` | `multipart/form-data` (`files`) | Upload d'images dans `dist/` (Add Assets) |
| `/resize_to_grid_to_dir` | — | Traite `dist/` → `dist32/` (rognage + pad multiples de 32) |

**Sécurité** : les routes qui écrivent valident le chemin (refus de `..`, des `/`/`\` non
attendus et des chemins absolus) pour rester dans l'arborescence du projet.

---

## 5. Page Index

Page principale (`index.html` + `app.js` + `app.css`).

### Barre du haut
- Navigation partagée (`topbar.css`).
- **Switch de source** `Default` / `<fichier chargé>` : bascule entre `assets_list.json`
  racine et un JSON chargé manuellement (gardé en mémoire et **persisté** entre rafraîchissements).
- **Load JSON** : charge un fichier. Si les chemins d'images sont des noms nus (pack validé),
  propose un **préfixe de base** (pré-rempli depuis `imageBase` si présent).
- **Check duplicates** : n'affiche que les doublons (même nom + direction + couleur),
  **groupés par lot** avec un en-tête par groupe.
- Toggle **dist32** + **Resize to 32px Grid** (outils de normalisation).

### Métadonnées de collection
Barre compacte : **nom de collection** + **tags globaux**.

### Filtres
- **Name** (sur le champ `name` uniquement), **Tags** (avec option **No tags** en tête de la
  liste), **Direction**, **Color** (avec option **No color** en tête, couleurs **triées par
  teinte**). Tous combinables.

### Cartes d'assets
- Image pleine largeur (fond damier pour la transparence), nom, tags, direction, couleur,
  couleur secondaire, catégorie, et **dates** (ajout / modif).
- Édition en place : toute modification met à jour les compteurs et sauvegarde (push serveur
  **débouncé**) sans reconstruire la grille.

### Barre d'actions (sélection)
- **Select / Deselect All**, **Bulk Edit** (édition en masse via modale),
  **Validate Selection**, **Delete** (retire du JSON, garde les fichiers).

### Validate Selection
Demande un nom de dossier → crée `validated/<nom>/` (images + JSON). **Refuse** si le dossier
existe déjà et redemande un autre nom.

---

## 6. Page Collections

`collection_list.html` — liste les packs de `validated/` via `/list_collections`.

Chaque carte : miniature, nom de collection, dossier, nombre d'images, tags, et bouton
**Use as default** (`/use_as_default`) qui définit ce pack comme collection racine.

---

## 7. Page Add Assets

`add_assets.html` — workflow d'import :
1. **Drag & drop** d'images ou d'un dossier (ou sélecteurs).
2. **Upload** vers `dist/` (`/upload_files`).
3. **Generate JSON** : produit un JSON au schéma standard (avec `dateAdded`), téléchargeable.

---

## 8. Page Align

`align.html` — réalignement d'images ayant des marges transparentes.

### Sources
- Colonne gauche : **sélecteur de collection** (switch `Default` / `Loaded`, recherche) +
  **chargement de fichier** (drag & drop).

### Édition (colonne droite)
- **Rognage** des bords transparents (auto, calcul de la bounding box opaque).
- **Drag** de l'image dans le cadre + **grille d'alignement 3×3** (coller à un bord / centrer).
- Options : *Keep content inside frame*, *Show 32px grid* (actif par défaut).
- **Miroir** : *Flip H* / *Flip V* (appliqué à l'aperçu et à toutes les sorties).

### Sauvegarde
- **Download** : PNG aligné en local.
- **Save now** : écrase le fichier d'origine (`/save_image`).
- **Add to batch** + **Save all** : file d'attente pour traiter plusieurs assets puis tout
  sauvegarder d'un coup. Changer d'image avec des modifs non sauvegardées propose
  *Add to batch / Discard / Cancel*.
- **Save as copy** : duplique en nouveau fichier + ajoute une entrée JSON
  (`/append_asset` pour la source Default, cache local pour la source Loaded). Un miroir
  horizontal inverse la direction `left`↔`right`.

Le cadre conserve la **taille d'origine** : aligner « à gauche » colle le contenu visible au
bord gauche sans changer les dimensions (utile pour les sprites sur grille).

---

## 9. Pipeline de scan

`image_processor.process_images(model_dir, src_dir, dist_dir, unknow_dir)` :

1. Parcourt `src/`. Pour chaque image :
   - **Direction** déduite du nom (`front`/`back`/`left`/`right`/`up`/`down`), sinon → `unknow/`.
   - **Couleur** : famille trouvée dans le nom, sinon estimée via la couleur moyenne (Pillow),
     sinon `grey`.
   - Renommage `name-color-direction-index.png` → copie vers `dist/`.
2. Re-scanne `dist/` pour reconstruire la collection (parsing du nom).
3. **Préserve les dates** existantes (fusion avec l'ancien `assets_list.json`).
4. Écrit `assets_list.json`.

Helpers de grille : `trim_transparent_borders`, `pad_to_multiple_of_32_center_x_align_bottom`,
`process_directory_to_grid` (utilisé par `/resize_to_grid_to_dir`).

---

## 10. Persistance & stockage local

- **Serveur** : `assets_list.json` (collection par défaut), `validated/<nom>/` (packs).
- **Navigateur (localStorage)** pour l'Index :
  - `assetmgr:source` — source active (`file` | `upload`).
  - `assetmgr:uploadCache` — dernier JSON chargé (avec chemins résolus) pour bascule instantanée
    et persistance au refresh.

---

## 11. Conventions & couleurs

### Directions
`front`, `back`, `left`, `right`, `up`, `down`, `unknow`.

### Familles de couleurs
Définies à l'identique côté Python et JS (`COLOR_FAMILIES`) : red, maroon, crimson, coral,
blue, navy, teal, cyan, light_blue, yellow, gold, green, lime, forest_green, olive, brown,
chocolate, saddlebrown, orange, purple, magenta, fuchsia, pink, hot_pink, grey, dark_grey,
light_grey, black, white, beige, tan. L'appartenance d'une couleur hex à une famille est
calculée par distance euclidienne RGB ; l'affichage du dropdown est **trié par teinte**.

### Catégories
Liste prédéfinie : Architecture & Buildings, Furniture & Decoration, Equipment & Objects,
Nature & Landscape, Infrastructure & Outdoor, Characters & Avatars, Vehicles & Transport,
Signage & UI, Interactive Elements, Lighting & VFX, Sound & Music, Special / Thematic.

### Tags par défaut
Furniture, Bathroom, Kitchen, Electronics, Bedroom, Office, Plants, Food & Drink, Decoration,
Transportation, Storage, Walls & Doors, Signage, Lighting, Meeting & School, Outdoor,
Recreation & Gaming.

---

## 12. Dépannage

| Symptôme | Cause / solution |
|----------|------------------|
| Une modif `.py` n'a aucun effet | Redémarrer le serveur (`Ctrl+C` puis relancer). |
| Une modif CSS/JS n'apparaît pas | Hard refresh navigateur (`Cmd/Ctrl + Shift + R`). |
| `Address already in use` | Un serveur tourne déjà sur le port ; l'arrêter, ou changer `--port`. |
| Validate écrit dans `validate elements` | Ancien serveur en mémoire → redémarrer. |
| Images d'un pack en 404 après *Load JSON* | Préfixer le bon chemin de base (ex. `validated/<nom>`) au chargement. |
| Couleur manquante (`No color`) après scan | Le scan assigne toujours au moins `grey` ; les assets sans couleur viennent surtout d'Add Assets. |
| Pas d'estimation de couleur au scan | Installer Pillow (`pip install pillow`). |
