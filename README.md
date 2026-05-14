# Steam PatchVault

Steam PatchVault est un site statique orienté joueurs pour explorer l'historique de patch notes Steam, retrouver des associations depot/manifest, puis générer une commande Steam Console prête à copier.

## Garanties du projet

- aucun fichier de jeu hébergé
- aucun login/mot de passe/cookie/token Steam demandé
- aucun contournement DRM
- seulement des métadonnées: AppID, DepotID, ManifestID, dates, sources, patch notes

## Runtime API-free (côté visiteur)

Le frontend **n'appelle aucune API Steam** pendant la navigation.

Le navigateur charge uniquement des fichiers JSON statiques hébergés sur GitHub Pages:

- `/data/search-index.json`
- `/data/games/<bucket>.json` (ex: `a.json`, `b.json`, `0-9.json`)
- `/data/patches/<appid>.json`
- `/data/manifests/<appid>.json`

Flux frontend:

1. chargement initial de `search-index.json`
2. recherche locale en mémoire
3. ouverture d'une fiche jeu → chargement du bucket correspondant (`/data/games/...`)
4. chargement des patch notes/manifests à la demande (`/data/patches/...`, `/data/manifests/...`)

## Database statique (génération)

La database est générée par le script:

- [scripts/build-static-db.mjs](/Users/julien/Documents/projets/steam-PatchVault/scripts/build-static-db.mjs)

### Sources API utilisées au build (pas au runtime)

- priorité: `IStoreService/GetAppList/v1` (si `STEAM_WEB_API_KEY` disponible)
- fallback: `ISteamApps/GetAppList/v2`
- patch notes: `ISteamNews/GetNewsForApp/v2` (`appid`, `count`, `enddate`, `maxlength`, `feeds`)

### Fallback local

Si les APIs sont indisponibles au build, le script peut retomber sur les fichiers sample existants (`games.sample.json`, `patches.sample.json`, `manifests.sample.json`) pour éviter de casser la publication.

## GitHub Actions (mise à jour quotidienne)

Workflow:

- [.github/workflows/static-db-refresh.yml](/Users/julien/Documents/projets/steam-PatchVault/.github/workflows/static-db-refresh.yml)

Comportement:

1. exécution quotidienne (cron) + déclenchement manuel
2. régénère `data/search-index.json`, `data/games/*`, `data/patches/*`, `data/manifests/*`
3. commit/push auto **uniquement si diff** dans `data`
4. ne fait rien si aucun changement

Secret recommandé:

- `STEAM_WEB_API_KEY` (repository secret)
- Permissions Actions: `Read and write permissions` pour autoriser le commit automatique des fichiers `data/*`.

## Lancer en local

### Site frontend

Option rapide:

1. Ouvrir `index.html`
2. Le fallback JS garde le site fonctionnel même en `file://`

Option recommandée:

```bash
cd /Users/julien/Documents/projets/steam-PatchVault
python3 -m http.server 8080
# puis ouvrir http://localhost:8080
```

### Générer la database statique localement

Mode sample (sans API externe):

```bash
PATCHVAULT_SOURCE=sample node scripts/build-static-db.mjs
```

Mode Steam API:

```bash
STEAM_WEB_API_KEY="votre_cle" node scripts/build-static-db.mjs
```

Variables utiles:

- `PATCHVAULT_MAX_APPS` (défaut `50000`)
- `PATCHVAULT_NEWS_COUNT` (défaut `12`)
- `PATCHVAULT_NEWS_MAXLENGTH` (défaut `2200`)
- `PATCHVAULT_NEWS_FEEDS` (défaut `steam_community_announcements`)
- `PATCHVAULT_PATCH_APPIDS` (liste csv d'appids à enrichir côté patch/news)

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
/scripts/build-static-db.mjs
/.github/workflows/static-db-refresh.yml
/data/search-index.json
/data/games/*.json
/data/patches/*.json
/data/manifests/*.json
/data/tracked-apps.json
/data/*.sample.json
/robots.txt
/sitemap.xml
/README.md
```

## Configuration des jeux suivis (patch/news)

Le fichier [data/tracked-apps.json](/Users/julien/Documents/projets/steam-PatchVault/data/tracked-apps.json) sert à:

- définir les jeux prioritaires
- enrichir nom/slug/description/tags/header
- choisir les AppIDs pour la génération patch/news/manifests statiques

## SEO

Optimisations déjà en place:

- `canonical`, `hreflang`, Open Graph, Twitter Cards
- JSON-LD (`WebSite`, `SoftwareApplication`)
- `robots.txt` + `sitemap.xml`
- `preconnect`/`dns-prefetch` pour domaines médias externes

Si vous changez le domaine/repo, mettez à jour:

- `index.html` (`canonical`, `og:url`, etc.)
- `robots.txt` (URL sitemap)
- `sitemap.xml` (`<loc>`)

## Déploiement GitHub Pages

```bash
git add .
git commit -m "feat: static steam database pipeline"
git branch -M main
git remote add origin https://github.com/<votre-user>/<votre-repo>.git
git push -u origin main
```

Ensuite:

- GitHub → Settings → Pages
- Source: `Deploy from a branch`
- Branch: `main`, folder `/ (root)`

## Limites actuelles

- la qualité des patch notes dépend des publications Steam disponibles
- les associations patch → manifest peuvent rester partielles
- certains AppIDs n'ont pas de news exploitables via `ISteamNews`
- le volume d'apps indexé dépend des limites/réponses des endpoints Steam

## Conformité

- pas d'API SteamDB
- pas de scraping SteamDB
- architecture compatible avec évolution backend future (Cloudflare Worker, Supabase, imports communautaires JSON/CSV)
