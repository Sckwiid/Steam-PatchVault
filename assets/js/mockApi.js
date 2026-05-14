(function initMockApi(global) {
  "use strict";

  var App = global.SteamPatchArchive = global.SteamPatchArchive || {};

  var FALLBACK_GAMES = [
    {
      appid: 413150,
      name: "Stardew Valley",
      slug: "stardew-valley",
      header_image: "https://cdn.akamai.steamstatic.com/steam/apps/413150/header.jpg",
      description: "Simulation agricole indé avec mods, coop et progression longue durée.",
      last_synced_at: "2026-05-10T08:14:00Z",
      tags: ["Indie", "RPG", "Modded"]
    },
    {
      appid: 294100,
      name: "RimWorld",
      slug: "rimworld",
      header_image: "https://cdn.akamai.steamstatic.com/steam/apps/294100/header.jpg",
      description: "Colony sim narratif orienté événements dynamiques et versions moddées.",
      last_synced_at: "2026-05-11T06:42:00Z",
      tags: ["Survival", "Indie", "Modded"]
    },
    {
      appid: 892970,
      name: "Valheim",
      slug: "valheim",
      header_image: "https://cdn.akamai.steamstatic.com/steam/apps/892970/header.jpg",
      description: "Survival coop nordique avec biomes, crafts et progression multijoueur.",
      last_synced_at: "2026-05-09T22:31:00Z",
      tags: ["Survival", "Multiplayer", "Speedrun"]
    }
  ];

  var FALLBACK_PATCHES_BY_APP = {
    "413150": [
      {
        id: "patch-sv-1",
        appid: 413150,
        title: "Mise à jour 1.6 - Festival & Qualité de vie",
        version_detected: "1.6.0",
        date: "2024-03-19T17:15:00Z",
        type: "major",
        content: "Ajout de nouveaux événements saisonniers, équilibrage des revenus et correction de sauvegardes incompatibles.",
        source_url: "https://store.steampowered.com/news/app/413150",
        source_type: "steam_news",
        keywords: ["festival", "economy", "mods", "save"]
      },
      {
        id: "patch-sv-2",
        appid: 413150,
        title: "Hotfix 1.6.2 - Correctifs coop",
        version_detected: "1.6.2",
        date: "2024-04-02T09:00:00Z",
        type: "hotfix",
        content: "Correction de crashs en coop locale et stabilité de ferme partagée.",
        source_url: "https://store.steampowered.com/news/app/413150",
        source_type: "steam_news",
        keywords: ["coop", "crash", "stability"]
      }
    ],
    "294100": [
      {
        id: "patch-rw-1",
        appid: 294100,
        title: "Mise à jour 1.5 - Pathfinding et IA",
        version_detected: "1.5.4069",
        date: "2024-04-11T15:40:00Z",
        type: "major",
        content: "Révision du pathfinding des colons et optimisation des raids.",
        source_url: "https://store.steampowered.com/news/app/294100",
        source_type: "steam_news",
        keywords: ["pathfinding", "ai", "raids", "performance"]
      }
    ],
    "892970": [
      {
        id: "patch-vh-1",
        appid: 892970,
        title: "Mise à jour biome - Ashlands",
        version_detected: "0.218.15",
        date: "2024-05-16T16:30:00Z",
        type: "major",
        content: "Nouveau biome, nouveaux ennemis et rééquilibrage des résistances.",
        source_url: "https://store.steampowered.com/news/app/892970",
        source_type: "steam_news",
        keywords: ["biome", "ashlands", "enemies", "balance"]
      }
    ]
  };

  var FALLBACK_MANIFESTS_BY_APP = {
    "413150": [
      {
        id: "manifest-sv-1",
        appid: 413150,
        depotid: 413151,
        manifestid: "7412554381023315481",
        buildid: "13660022",
        branch: "public",
        os: "windows",
        language: "all",
        date: "2024-03-19T17:22:00Z",
        patch_note_id: "patch-sv-1",
        confidence_score: 93,
        notes: "Horodatage proche de la publication officielle."
      }
    ],
    "294100": [
      {
        id: "manifest-rw-1",
        appid: 294100,
        depotid: 294101,
        manifestid: "7090114798123405571",
        buildid: "14102208",
        branch: "public",
        os: "windows",
        language: "all",
        date: "2024-04-11T15:47:00Z",
        patch_note_id: "patch-rw-1",
        confidence_score: 90,
        notes: "Alignement build/notes confirmé par source Steam News."
      }
    ],
    "892970": [
      {
        id: "manifest-vh-1",
        appid: 892970,
        depotid: 892971,
        manifestid: "1189435172299604470",
        buildid: "14533102",
        branch: "public",
        os: "windows",
        language: "all",
        date: "2024-05-16T16:35:00Z",
        patch_note_id: "patch-vh-1",
        confidence_score: 92,
        notes: "Mise à jour majeure, build principal très probable."
      }
    ]
  };

  var state = {
    searchIndex: null,
    bucketCache: {},
    patchByAppCache: {},
    manifestsByAppCache: {}
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function byDateDesc(left, right) {
    return new Date(right.date).getTime() - new Date(left.date).getTime();
  }

  function normalizeBucket(name) {
    var first = String(name || "").trim().charAt(0).toLowerCase();
    return /[a-z]/.test(first) ? first : "0-9";
  }

  function buildFallbackSearchIndex() {
    var games = FALLBACK_GAMES.map(function mapGame(game) {
      var entry = Object.assign({}, game);
      entry.bucket = normalizeBucket(game.name);
      return entry;
    });

    var buckets = {};
    games.forEach(function eachGame(game) {
      buckets[game.bucket] = game.bucket;
    });

    return {
      generated_at: "2026-05-14T00:00:00Z",
      total_games: games.length,
      buckets: buckets,
      games: games
    };
  }

  function buildFallbackGameBucket(bucket) {
    var games = FALLBACK_GAMES.filter(function filterGame(game) {
      return normalizeBucket(game.name) === bucket;
    });
    return {
      bucket: bucket,
      generated_at: "2026-05-14T00:00:00Z",
      games: games
    };
  }

  function buildFallbackPatchesFile(appid) {
    var id = String(appid);
    return {
      appid: Number(appid),
      generated_at: "2026-05-14T00:00:00Z",
      patches: clone(FALLBACK_PATCHES_BY_APP[id] || [])
    };
  }

  function buildFallbackManifestsFile(appid) {
    var id = String(appid);
    return {
      appid: Number(appid),
      generated_at: "2026-05-14T00:00:00Z",
      manifests: clone(FALLBACK_MANIFESTS_BY_APP[id] || [])
    };
  }

  async function loadJsonFile(path, fallbackValue) {
    if (global.location.protocol === "file:") {
      return clone(fallbackValue);
    }

    var candidates = [path, path.replace(/^\.\//, "")];
    for (var i = 0; i < candidates.length; i += 1) {
      try {
        var response = await fetch(candidates[i], { cache: "no-store" });
        if (!response.ok) continue;
        return await response.json();
      } catch (error) {
        // Continue with next candidate.
      }
    }

    return clone(fallbackValue);
  }

  async function ensureSearchIndexLoaded() {
    if (state.searchIndex) return state.searchIndex;

    var fallback = buildFallbackSearchIndex();
    var loaded = await loadJsonFile("./data/search-index.json", fallback);

    if (!loaded || !Array.isArray(loaded.games)) {
      state.searchIndex = fallback;
      return state.searchIndex;
    }

    state.searchIndex = loaded;
    return state.searchIndex;
  }

  async function loadGamesBucket(bucket) {
    var key = bucket || "0-9";
    if (state.bucketCache[key]) return state.bucketCache[key];

    var fallback = buildFallbackGameBucket(key);
    var loaded = await loadJsonFile("./data/games/" + key + ".json", fallback);

    var games = loaded && Array.isArray(loaded.games) ? loaded.games : fallback.games;
    state.bucketCache[key] = games;
    return games;
  }

  async function loadPatchesByApp(appid) {
    var key = String(appid || "");
    if (state.patchByAppCache[key]) return state.patchByAppCache[key];

    var fallback = buildFallbackPatchesFile(appid);
    var loaded = await loadJsonFile("./data/patches/" + key + ".json", fallback);

    var patches = loaded && Array.isArray(loaded.patches) ? loaded.patches : fallback.patches;
    state.patchByAppCache[key] = patches.sort(byDateDesc);
    return state.patchByAppCache[key];
  }

  async function loadManifestsByApp(appid) {
    var key = String(appid || "");
    if (state.manifestsByAppCache[key]) return state.manifestsByAppCache[key];

    var fallback = buildFallbackManifestsFile(appid);
    var loaded = await loadJsonFile("./data/manifests/" + key + ".json", fallback);

    var manifests = loaded && Array.isArray(loaded.manifests) ? loaded.manifests : fallback.manifests;
    state.manifestsByAppCache[key] = manifests.sort(byDateDesc);
    return state.manifestsByAppCache[key];
  }

  async function searchGames(query) {
    var index = await ensureSearchIndexLoaded();
    var games = Array.isArray(index.games) ? index.games : [];
    var search = App.search;
    var cleanQuery = search && search.normalizeText ? search.normalizeText(query) : String(query || "").trim().toLowerCase();

    if (!cleanQuery) {
      return games.slice(0, 24);
    }

    if (!search) {
      return games;
    }

    var primaryResults = search.searchGames(games, cleanQuery, { limit: 24, minScore: 26 });
    var queryBucket = normalizeBucket(cleanQuery);
    var bucketGames = await loadGamesBucket(queryBucket);
    var mergedByAppId = Object.create(null);

    games.concat(bucketGames).forEach(function eachGame(game) {
      if (!game || !game.appid) return;
      mergedByAppId[String(game.appid)] = game;
    });

    var expandedGames = Object.keys(mergedByAppId).map(function mapKey(appid) {
      return mergedByAppId[appid];
    });

    var expandedResults = search.searchGames(expandedGames, cleanQuery, { limit: 24, minScore: 18 });
    var finalResults = expandedResults.length ? expandedResults : primaryResults;

    return finalResults.map(function mapEntry(entry) {
      var result = Object.assign({}, entry.game);
      result.search_score = entry.score;
      return result;
    });
  }

  async function getAllGames() {
    var index = await ensureSearchIndexLoaded();
    return Array.isArray(index.games) ? index.games.slice() : [];
  }

  async function getGameBySlug(slug) {
    var index = await ensureSearchIndexLoaded();
    var cleanSlug = String(slug || "").trim();

    var summary = (index.games || []).find(function findSummary(item) {
      return item.slug === cleanSlug;
    });

    if (!summary) return null;

    var bucket = summary.bucket || normalizeBucket(summary.name);
    var bucketGames = await loadGamesBucket(bucket);

    var full = bucketGames.find(function findGame(game) {
      return game.slug === cleanSlug;
    });

    return full || summary;
  }

  async function getPatchesByAppId(appid) {
    var id = String(appid || "");
    var storage = App.storage;

    if (storage) {
      var cached = storage.getCachedPatches(id);
      if (cached) return cached.slice().sort(byDateDesc);
    }

    var patches = await loadPatchesByApp(id);

    if (storage) {
      storage.cachePatches(id, patches);
    }

    return patches.slice();
  }

  async function getManifestsByPatchId(patchId, appid) {
    if (!appid) return [];
    var manifests = await loadManifestsByApp(appid);
    return manifests.filter(function filterManifest(manifest) {
      return manifest.patch_note_id === patchId;
    });
  }

  async function getManifestsByAppId(appid) {
    var manifests = await loadManifestsByApp(appid);
    return manifests.slice();
  }

  async function refreshGameFromSteam(appid) {
    return {
      ok: false,
      appid: appid,
      message: "Mode runtime API-free: les données sont régénérées par GitHub Actions en JSON statiques."
    };
  }

  async function refreshNewsFromSteam(appid) {
    return {
      ok: false,
      appid: appid,
      message: "Mode runtime API-free: aucune requête Steam API côté visiteur."
    };
  }

  App.api = {
    searchGames: searchGames,
    getAllGames: getAllGames,
    getGameBySlug: getGameBySlug,
    getPatchesByAppId: getPatchesByAppId,
    getManifestsByPatchId: getManifestsByPatchId,
    getManifestsByAppId: getManifestsByAppId,
    refreshGameFromSteam: refreshGameFromSteam,
    refreshNewsFromSteam: refreshNewsFromSteam
  };
})(window);
