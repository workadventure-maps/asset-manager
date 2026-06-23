# Assets Collection Manager

Outil web local pour **organiser, éditer et préparer des assets graphiques** (sprites PNG).
Il permet de scanner des images, de leur attribuer des métadonnées (nom, direction, couleur,
tags, catégorie, dates), de filtrer/éditer la collection via une interface web, de **réaligner**
les images, de constituer des **packs validés**, et de basculer la collection par défaut.

> 📖 Documentation détaillée : voir **[DOCUMENTATION.md](DOCUMENTATION.md)**.

---

## 🚀 Démarrage rapide

```bash
# 1. (optionnel) scanner les images de src/ vers dist/ et générer assets_list.json
python3 main.py --mode scan

# 2. lancer le serveur web (sert les pages + l'API)
python3 main.py --mode serve
```

Puis ouvre **http://localhost:8000** dans le navigateur.

> ⚠️ Toute modification d'un fichier `.py` nécessite de **redémarrer le serveur**
> (`Ctrl+C` puis relance). Les modifications de pages/JS/CSS ne demandent qu'un
> rechargement forcé du navigateur (`Cmd/Ctrl + Shift + R`, le serveur ne pose pas d'anti-cache).

Dépendance optionnelle : **Pillow** (`pip install pillow`) pour l'estimation de couleur au scan
et le traitement d'images. Le reste fonctionne sans dépendance externe.

---

## 📂 Arborescence

```
.
├── main.py               # Orchestrateur CLI (clean / scan / serve / …)
├── server.py             # Serveur HTTP + API JSON (pages "jolies" + routes POST)
├── image_processor.py    # Scan src/ → dist/, couleur, dates, normalisation 32px
├── clean-images.py       # Nettoyage des dossiers d'images
│
├── index.html            # Page principale : collection (filtres, édition, validate, delete…)
├── add_assets.html       # Import d'images + génération d'un JSON
├── align.html            # Réalignement / rognage / miroir / duplication d'images
├── collection_list.html  # Liste des packs de validated/ + "Use as default"
├── collisions.html       # Outil collisions (existant)
│
├── app.js                # Logique de l'index
├── app.css               # Styles de l'index
├── topbar.css            # Barre de navigation partagée (toutes les pages)
├── collisions.css / .js  # Page collisions
│
├── assets_list.json      # Base de données de la collection (racine = collection par défaut)
├── src/                  # Images sources à traiter (entrée du scan)
├── dist/                 # Images organisées (sortie du scan, servies par le serveur)
├── dist32/               # Versions normalisées sur grille 32px (optionnel)
├── unknow/               # Images sans direction détectée
└── validated/            # Packs validés : validated/<nom>/ (images + assets_list.json)
```

---

## 🧭 Les pages

| Page | URL | Rôle |
|------|-----|------|
| **Index** | `/` | Parcourir, filtrer et éditer la collection ; valider une sélection ; supprimer ; doublons |
| **Collections** | `/collection-list` | Lister les packs de `validated/`, en définir un par défaut |
| **Add Assets** | `/add-assets` | Importer des images dans `dist/` et générer un JSON |
| **Align** | `/align` | Recadrer, aligner, mettre en miroir et dupliquer des images |
| **Collisions** | `/collisions` | Outil de collisions |

---

## 🗃️ Schéma d'un asset (`assets_list.json`)

```json
{
  "collectionName": "Assets",
  "tags": ["Furniture", "Outdoor"],
  "collection": [
    {
      "imagePath": "dist/chair-brown-front-1.png",
      "name": "chair",
      "tags": ["Furniture"],
      "direction": "front",
      "color": "#A52A2A",
      "secondaryColor": "",
      "category": "Furniture & Decoration",
      "dateAdded": "2026-06-23T14:00:00Z",
      "dateModified": ""
    }
  ]
}
```

---

## 🔁 Workflows typiques

- **Constituer un pack** : Index → filtrer/éditer → sélectionner → **Validate Selection** →
  crée `validated/<nom>/` (images + JSON). Voir la liste dans **Collections**.
- **Changer la collection par défaut** : **Collections** → **Use as default** (réécrit
  `assets_list.json` racine).
- **Corriger des marges transparentes** : **Align** → choisir l'asset → aligner / rogner /
  miroir → **Save now** ou **Add to batch** puis **Save all**.
- **Dupliquer un sprite en miroir** : **Align** → Flip H → **Save as copy** (nouveau fichier +
  entrée JSON, direction `left`/`right` inversée automatiquement).

---

## 🛠️ CLI `main.py`

| Mode | Effet |
|------|-------|
| `--mode serve` | Lance uniquement le serveur web (défaut) |
| `--mode scan` | Scanne `src/` → `dist/` et met à jour `assets_list.json` |
| `--mode clean` | Exécute `clean-images.py` |
| `--mode clean-scan` | Clean puis scan |
| `--mode all` | Clean + scan + serve |

Options : `--src-dir`, `--dist-dir`, `--unknow-dir`, `--model-dir`, `--host`, `--port`.

---

Pour le détail des routes API, des filtres, des formats et des comportements,
voir **[DOCUMENTATION.md](DOCUMENTATION.md)**.
