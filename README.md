# Steam PatchVault

Site statique orienté joueurs pour explorer l'historique de patch notes Steam, retrouver des associations depot/manifest, puis générer une commande Steam Console prête à copier.

## Objectif

Steam PatchVault aide à:

- chercher un jeu Steam
- lire une timeline claire de patch notes
- filtrer par version/date/mot-clé/type
- consulter des manifests associés (quand disponibles)
- copier une commande `download_depot APP_ID DEPOT_ID MANIFEST_ID`
- ouvrir rapidement la console Steam via `steam://open/console`

Le site **n'héberge aucun fichier de jeu**, **ne demande aucun login/token/cookie Steam** et **ne contourne pas le DRM**.

## Lancer en local

Option 1 (sans serveur):

1. Ouvrir `index.html` directement dans le navigateur.
2. Le site fonctionne grâce au fallback `mockApi.js` (utile en `file://` si le chargement JSON est bloqué par le navigateur).

Option 2 (serveur local recommandé):

```bash
cd /Users/julien/Documents/projets/steam-PatchVault
python3 -m http.server 8080
# puis ouvrir http://localhost:8080
```

## Déploiement GitHub Pages

### Déploiement simple depuis `main` (racine)

1. Pousser le projet:

```bash
git add .
git commit -m "feat: Steam PatchVault MVP statique"
git branch -M main
git remote add origin https://github.com/<votre-user>/<votre-repo>.git
git push -u origin main
```

2. Activer GitHub Pages (dans GitHub):

- Settings
- Pages
- Build and deployment
- Source: `Deploy from a branch`
- Branch: `main` / `root`

### Variante via GitHub CLI

```bash
gh repo edit --enable-pages --pages-source main --pages-path /
```

## Structure

```text
/index.html
/assets/css/styles.css
/assets/js/app.js
/assets/js/search.js
/assets/js/storage.js
/assets/js/steamCommands.js
/assets/js/router.js
/assets/js/mockApi.js
/data/games.sample.json
/data/patches.sample.json
/data/manifests.sample.json
/README.md
```

## Architecture technique

- 100% statique (MVP)
- HTML/CSS/JS vanilla (pas de framework)
- routeur hash:
  - `#/`
  - `#/game/:slug`
  - `#/tutorial`
  - `#/about`
- modules JS globaux via `window.SteamPatchArchive` (compatibles ouverture directe `index.html`)
- couche API simulée dans `mockApi.js` avec fonctions remplaçables plus tard:
  - `searchGames(query)`
  - `getGameBySlug(slug)`
  - `getPatchesByAppId(appid)`
  - `getManifestsByPatchId(patchId)`
  - `refreshGameFromSteam(appid)` (placeholder)
  - `refreshNewsFromSteam(appid)` (placeholder)

## Cache local (`storage.js`)

Stockage via `localStorage` avec TTL (24h):

- dernières recherches
- jeux consultés récemment
- patch notes déjà chargés
- préférences utilisateur

Constante TTL: `24 * 60 * 60 * 1000`.

## Comportement des commandes Steam Console

Commande générée:

```text
download_depot APP_ID DEPOT_ID MANIFEST_ID
```

Bouton principal "Copier + ouvrir Steam Console":

1. copie la commande (Clipboard API)
2. feedback visuel
3. tentative d'ouverture `steam://open/console`
4. instruction affichée: coller avec `Ctrl+V` puis `Entrée`

Fallbacks prévus:

- si copie bloquée: bloc manuel visible
- si `steam://open/console` ne répond pas: aide affichée (Exécuter Windows, option `-console`)

## Ajouter un jeu

Modifier `data/games.sample.json`:

```json
{
  "appid": 123456,
  "name": "Nom du jeu",
  "slug": "nom-du-jeu",
  "header_image": "https://.../header.jpg",
  "description": "Description courte",
  "last_synced_at": "2026-05-14T12:00:00Z",
  "tags": ["Indie", "RPG"]
}
```

Points importants:

- `slug` unique (utilisé par la route `#/game/:slug`)
- `appid` cohérent avec patches/manifests

## Ajouter un patch note

Modifier `data/patches.sample.json`:

```json
{
  "id": "patch-xyz-1",
  "appid": 123456,
  "title": "Patch title",
  "version_detected": "1.2.3",
  "date": "2025-10-01T09:00:00Z",
  "type": "major",
  "content": "Détails du patch",
  "source_url": "https://...",
  "source_type": "steam_news",
  "keywords": ["performance", "mods"]
}
```

`type` autorisés: `major`, `minor`, `hotfix`, `balance`, `content`.

## Ajouter un manifest

Modifier `data/manifests.sample.json`:

```json
{
  "id": "manifest-xyz-1",
  "appid": 123456,
  "depotid": 123457,
  "manifestid": "1234567890123456789",
  "buildid": "9876543",
  "branch": "public",
  "os": "windows",
  "language": "all",
  "date": "2025-10-01T09:10:00Z",
  "patch_note_id": "patch-xyz-1",
  "confidence_score": 82,
  "notes": "Association non garantie"
}
```

`confidence_score` doit rester entre 0 et 100.

## Limites techniques du MVP

- pas de backend ni synchronisation temps réel
- données d'exemple (non garanties)
- disponibilité des manifests non garantie
- certaines associations patch → manifest reposent sur heuristiques temporelles
- pas d'exécution automatisée de commandes locales

## Accessibilité

- contraste fort sur fond sombre
- navigation clavier possible sur les boutons clés
- `aria-label` sur actions critiques
- animations sobres
- support `prefers-reduced-motion`

## Évolution recommandée

1. Ajouter un backend Cloudflare Worker pour appeler des sources officielles et normaliser les données.
2. Brancher un stockage serveur (KV / D1 / Supabase) pour cache multi-utilisateurs et historiques de builds.
3. Introduire un pipeline d'import JSON/CSV communautaire avec validation de schéma.
4. Ajouter une tâche de scoring automatique (patch ↔ manifest) versionnée et auditée.
5. Ajouter une page de statut de synchronisation par jeu avec journal d'import.

## Conformité projet

- pas d'API SteamDB
- pas de scraping SteamDB
- architecture prévue pour:
  - Steam Web API officielle
  - données communautaires
  - imports manuels JSON/CSV
  - backend personnel futur
