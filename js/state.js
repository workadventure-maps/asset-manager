export const API_URL = 'http://localhost:8000';
export const ASSETS_FILE = 'assets_list.json';

export const ALL_TAGS_DEFAULT = [
    "Furniture","Bathroom","Kitchen","Electronics","Bedroom","Office",
    "Plants","Food & Drink","Decoration","Transportation","Storage",
    "Walls & Doors","Signage","Lighting","Meeting & School","Outdoor",
    "Recreation & Gaming"
];

export const ALL_DIRECTIONS = ["front","back","left","right"];

/* Catalogue de catégories (libellé + légende) — garde si tu l’utilises */
export const CATEGORY_CATALOG = [
    { label: "Architecture & Bâtiments", hint: "murs, toits, maisons, bureaux, magasins…" },
    { label: "Mobilier & Décoration", hint: "chaises, tables, lampes, tapis, tableaux…" },
    { label: "Équipements & Objets", hint: "ordinateurs, machines, outils, distributeurs…" },
    { label: "Nature & Paysage", hint: "arbres, plantes, rochers, eau, ciel, météo…" },
    { label: "Infrastructures & Extérieur", hint: "routes, ponts, trottoirs, clôtures, bancs, fontaines…" },
    { label: "Personnages & Avatars", hint: "NPC, sprites, costumes, accessoires…" },
    { label: "Véhicules & Transport", hint: "voitures, vélos, bateaux, avions…" },
    { label: "Signalétique & UI", hint: "panneaux, affiches, icônes, flèches, signalisation…" },
    { label: "Éléments interactifs", hint: "portes, boutons, terminaux, bornes arcade…" },
    { label: "Éclairage & Effets visuels", hint: "lampadaires, torches, néons, particules, halos de lumière…" },
    { label: "Son & Musique", hint: "bruitages, ambiances, musiques de fond" },
    { label: "Spécial / Thématique", hint: "fêtes, saisonniers, culturels, futuristes, médiévaux…" }
];

export const COLOR_FAMILIES = {
    red:"#FF0000",maroon:"#800000",crimson:"#DC143C",coral:"#FF7F50",
    blue:"#0000FF",navy:"#000080",teal:"#008080",cyan:"#00FFFF",
    light_blue:"#ADD8E6",yellow:"#FFFF00",gold:"#FFD700",green:"#00FF00",
    lime:"#00FF00",forest_green:"#228B22",olive:"#808000",brown:"#A52A2A",
    chocolate:"#D2691E",saddlebrown:"#8B4513",orange:"#FFA500",purple:"#800080",
    magenta:"#FF00FF",fuchsia:"#FF00FF",pink:"#FFC0CB",hot_pink:"#FF69B4",
    grey:"#808080",dark_grey:"#A9A9A9",light_grey:"#D3D3D3",black:"#000000",
    white:"#FFFFFF",beige:"#F5F5DC",tan:"#D2B48C"
};

export const state = {
    data:{ collectionName:'', tags:[], collection:[] }, // tags = tags de collection (JSON racine)
    selected: new Set(),
    counts: { tags:{}, direction:{}, color:{} },
    availableTags: [],
    renderList: [],
    page: 0,
    pageSize: 100,
    filters: {
        name: '',
        tags: [],
        direction: '',
        colorFamily: '',
        missingTags: false,
        missingColor: false,
        missingDirection: false,
    },
    cardsByPath: new Map(),

    /* 🆕 Sélections de cases de grille par asset : Map<imagePath, Set<'cx,cy'>> */
    gridSelections: new Map(),

    debounceTimers: {}
};