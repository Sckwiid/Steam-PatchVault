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

## Scan appinfo/PICS (mapping depotid -> appid)

Workflow dédié:

- [.github/workflows/scan-appinfo-pics.yml](/Users/julien/Documents/projets/steam-PatchVault/.github/workflows/scan-appinfo-pics.yml)

Scripts Python:

- [scripts/scan_appinfo_pics.py](/Users/julien/Documents/projets/steam-PatchVault/scripts/scan_appinfo_pics.py)
- [scripts/build_depot_to_app_index.py](/Users/julien/Documents/projets/steam-PatchVault/scripts/build_depot_to_app_index.py)
- [scripts/merge_github_manifests_with_depots.py](/Users/julien/Documents/projets/steam-PatchVault/scripts/merge_github_manifests_with_depots.py)
- [scripts/scan_sensitive_data.py](/Users/julien/Documents/projets/steam-PatchVault/scripts/scan_sensitive_data.py)
- [scripts/config.py](/Users/julien/Documents/projets/steam-PatchVault/scripts/config.py)
- [scripts/utils.py](/Users/julien/Documents/projets/steam-PatchVault/scripts/utils.py)

Flux:

1. scan d'`appid` via appinfo/PICS (provider chain: `steam-pics-api` -> `steamkit` -> `steamcmd` -> `mock`)
2. snapshot dans `/data/appinfo-snapshots/<appid>/<date>.json`
3. génération de `/data/depot-to-app-index.json` (shared depots supportés)
4. génération de `/data/app-to-depots-index.json`
5. merge de `/data/community-manifest-index.json` vers `/data/manifests/<appid>.json`
6. écriture des non mappés dans `/data/unmapped-manifests/<depotid>.json`
7. contrôle strict des champs sensibles avant commit

## Déclenchement scan via Netlify Function (anti-spam)

Fichiers ajoutés:

- [netlify/functions/request-scan.mjs](/Users/julien/Documents/projets/steam-PatchVault/netlify/functions/request-scan.mjs)
- [netlify/functions/resolve-steam-game.mjs](/Users/julien/Documents/projets/steam-PatchVault/netlify/functions/resolve-steam-game.mjs)
- [netlify/functions/persist-community-manifests.mjs](/Users/julien/Documents/projets/steam-PatchVault/netlify/functions/persist-community-manifests.mjs)
- [netlify.toml](/Users/julien/Documents/projets/steam-PatchVault/netlify.toml)

But:

- quand un joueur ouvre une fiche jeu avec data incomplète, le frontend peut demander un scan appinfo/PICS
- si un slug n'existe pas encore localement, le frontend peut résoudre la fiche en live via Steam (Netlify Function), puis afficher les news/patch notes récentes
- quand une recherche manuelle GitHub trouve des manifests, le frontend peut pousser ces résultats dans `data/community-manifest-index.json` (merge + commit GitHub)
- la Function Netlify déclenche `scan-appinfo-pics.yml` via l’API GitHub Actions
- anti-spam activé côté client + côté Function + côté workflow

Protections anti-spam:

1. cooldown local navigateur
   - manuel: 6h
   - auto: 24h
2. burst guard Function (requêtes rapprochées bloquées)
3. vérification des runs GitHub récents (queued/in_progress/cooldown)
4. `concurrency` workflow par AppID dans `scan-appinfo-pics.yml`

Variables Netlify à configurer:

- `GITHUB_PAT` (token GitHub avec droits `repo` + `workflow`)
- `GITHUB_OWNER` (ex: `Sckwiid`)
- `GITHUB_REPO` (ex: `Steam-PatchVault`)
- `GITHUB_SCAN_WORKFLOW` (optionnel, défaut: `scan-appinfo-pics.yml`)
- `GITHUB_SCAN_REF` (optionnel, défaut: `main`)
- `SCAN_COOLDOWN_MINUTES` (optionnel, défaut: `360`)
- `PERSIST_MANIFEST_COOLDOWN_MINUTES` (optionnel, défaut: `15`)
- `SCAN_CORS_ORIGIN` (optionnel, défaut: `*`)
- `SCAN_ALLOWED_ORIGINS` (optionnel, liste CSV d’origines autorisées)

Si le frontend est déployé sur GitHub Pages (et la Function sur Netlify):

- renseigner l’endpoint Netlify dans `index.html`:
  - `window.STEAM_PATCHVAULT_CONFIG.scanEndpoint = "https://<ton-site>.netlify.app/.netlify/functions/request-scan"`
  - `window.STEAM_PATCHVAULT_CONFIG.persistManifestsEndpoint = "https://<ton-site>.netlify.app/.netlify/functions/persist-community-manifests"`
  - `window.STEAM_PATCHVAULT_CONFIG.liveResolveEndpoint = "https://<ton-site>.netlify.app/.netlify/functions/resolve-steam-game"`

### Setup rapide Netlify (écran "Builds")

1. Cliquer `New project from Git`
2. Sélectionner le repo `Steam-PatchVault`
3. Dans `Site configuration` -> `Environment variables`, ajouter les variables ci-dessus
4. Lancer un deploy
5. Vérifier la Function sur:
   - `https://<ton-site>.netlify.app/.netlify/functions/request-scan`
   - `https://<ton-site>.netlify.app/.netlify/functions/resolve-steam-game?slug=phasmophobia`
   - `https://<ton-site>.netlify.app/.netlify/functions/persist-community-manifests`

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
/scripts/scan_appinfo_pics.py
/scripts/build_depot_to_app_index.py
/scripts/merge_github_manifests_with_depots.py
/scripts/scan_sensitive_data.py
/scripts/config.py
/scripts/utils.py
/scripts/requirements.txt
/.github/workflows/static-db-refresh.yml
/.github/workflows/scan-appinfo-pics.yml
/data/search-index.json
/data/games/*.json
/data/patches/*.json
/data/manifests/*.json
/data/app-to-depots-index.json
/data/manifest-snapshots/<appid>/<date>.json
/data/appinfo-snapshots/<appid>/<date>.json
/data/contributions/pending-manifests.json
/data/depot-to-app-index.json
/data/community-manifest-index.json (optionnel)
/data/unmapped-manifests/<depotid>.json
/data/import-stats.json
/data/tracked-apps.json
/data/priority-appids.json
/data/mock/appinfo/<appid>.json
/data/manual/patches/*.json
/data/manual/manifests/*.json
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

## Imports manuels de patchs et manifests

Steam ne fournit pas toujours l'historique complet `DepotID` + `ManifestID`. Pour compléter la base sans API SteamDB et sans scraping, ajoutez des fichiers manuels dans `data/manual`.

Ne modifiez pas directement:

- `data/patches/<appid>.json`
- `data/manifests/<appid>.json`

Ces fichiers sont générés par le workflow et peuvent être écrasés.

### Ajouter des patch notes manuellement

Créez un fichier:

```text
data/manual/patches/739630.json
```

Format:

```json
{
  "patches": [
    {
      "id": "manual-739630-2024-08-12",
      "appid": 739630,
      "title": "Titre du patch",
      "version_detected": "0.10",
      "date": "2024-08-12T18:00:00.000Z",
      "type": "major",
      "content": "Résumé court du patch.",
      "source_url": "https://store.steampowered.com/news/app/739630",
      "source_type": "manual",
      "keywords": ["content", "performance"]
    }
  ]
}
```

### Ajouter des depots/manifests manuellement

Créez un fichier:

```text
data/manual/manifests/739630.json
```

Format:

```json
{
  "manifests": [
    {
      "id": "manual-739630-739631-2382933349983046343",
      "appid": 739630,
      "depotid": 739631,
      "manifestid": "2382933349983046343",
      "buildid": "unknown",
      "branch": "public",
      "os": "windows",
      "language": "all",
      "date": "2024-08-12T18:00:00.000Z",
      "patch_note_id": "manual-739630-2024-08-12",
      "confidence_score": 70,
      "notes": "Ajout manuel. Disponibilité non garantie."
    }
  ]
}
```

`patch_note_id` doit correspondre à l'`id` d'une patch note existante ou importée manuellement. Si l'association est incertaine, baissez `confidence_score`.

Après ajout:

```bash
node scripts/build-static-db.mjs
git add data/manual data/patches data/manifests
git commit -m "data: add manual manifests for app 739630"
git push
```

Sur GitHub, le workflow quotidien fusionnera aussi automatiquement les imports manuels dans les fichiers publics.

## Mode développement local appinfo/PICS

Sans SteamCMD/SteamKit disponibles, placez des mocks dans:

- `/data/mock/appinfo/<appid>.json`

Puis exécutez:

```bash
python3 scripts/scan_appinfo_pics.py --appid 739630,1091500
python3 scripts/build_depot_to_app_index.py
python3 scripts/merge_github_manifests_with_depots.py
python3 scripts/scan_sensitive_data.py
```

Cela permet de tester toute la pipeline metadata sans dépendre d'un backend Steam côté visiteur.

## Historisation des manifests

Le build statique conserve l'historique des manifests connus au lieu de remplacer brutalement l'état précédent.

À chaque exécution:

- les manifests existants dans `data/manifests/<appid>.json` sont relus
- les imports manuels sont fusionnés
- les manifests déjà connus gardent leur `first_seen_at`
- les manifests revus pendant le scan mettent à jour `last_seen_at`
- un snapshot daté est écrit dans `data/manifest-snapshots/<appid>/<date>.json`
- les manifests sont regroupés par depot dans `data/manifests/<appid>.json`

Format public:

```json
{
  "appid": 1091500,
  "last_scanned_at": "2026-05-14T03:00:00Z",
  "tracked_since": "2026-05-14T03:00:00Z",
  "depots": [
    {
      "depotid": 1091501,
      "name": "Windows Content",
      "os": "windows",
      "language": "all",
      "manifests": [
        {
          "manifestid": "1234567890123456789",
          "buildid": "9876543",
          "branch": "public",
          "first_seen_at": "2026-05-14T03:00:00Z",
          "last_seen_at": "2026-05-15T03:00:00Z",
          "patch_note_id": "1091500-2026-05-14-001",
          "confidence_score": 80,
          "source": "steam_appinfo_snapshot",
          "status": "unverified",
          "download_command": "download_depot 1091500 1091501 1234567890123456789"
        }
      ]
    }
  ]
}
```

Important: ce système historise ce qui est détecté à partir du moment où le projet suit un jeu. Il ne reconstruit pas automatiquement tout l'historique Steam passé.

## Contributions communautaires

Le frontend affiche:

- `Détecté automatiquement`
- `Confirmé communauté`
- `Non garanti`
- bouton `Proposer un manifest`
- bouton `Signaler manifest invalide`

Les boutons ouvrent une GitHub Issue pré-remplie. Après validation, ajoutez la donnée dans `data/manual/manifests/<appid>.json`.

## Recherche distante GitHub des manifests

Le module [assets/js/githubManifestSearch.js](/Users/julien/Documents/projets/steam-PatchVault/assets/js/githubManifestSearch.js) permet une recherche optionnelle côté navigateur dans des index GitHub publics de fichiers `.manifest`.

Priorité:

1. charger `data/community-manifest-index.json` si le fichier existe
2. sinon utiliser GitHub Trees API en fallback

Sources distantes configurées:

- `qwe213312/k25FCdfEOoEJ42S6`
- `mejikuhibiniu1/k25FCdfEOoEJ42S6`
- `Sainan/k25FCdfEOoEJ42S6`

Le site ne télécharge jamais le contenu des fichiers `.manifest`. Il lit uniquement l'arborescence GitHub et parse les noms de fichiers au format:

```text
depotid_manifestid.manifest
```

Regex stricte utilisée sur le nom de fichier:

```text
^(\d+)_(\d+)\.manifest$
```

Limites:

- GitHub peut retourner `truncated: true`
- les résultats sont alors affichés comme partiels
- les manifests restent `unverified`
- ManifestID connu ne garantit pas que Steam permettra le téléchargement

Le cache navigateur utilise:

```text
github-manifests:<appid>
```

TTL: 24h.

Pour une version plus robuste, générer plus tard `data/community-manifest-index.json` via GitHub Actions afin d'éviter les appels GitHub côté visiteur.

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
