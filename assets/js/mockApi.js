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
    appToDepotsIndex: null,
    bucketCache: {},
    patchByAppCache: {},
    manifestsByAppCache: {},
    liveGameBySlugCache: {},
    liveGameByAppIdCache: {}
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

  function slugify(input) {
    return String(input || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "steam-app";
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

  function getLiveResolverEndpoint() {
    var config = global.STEAM_PATCHVAULT_CONFIG || {};
    if (config.liveResolveEndpoint) return String(config.liveResolveEndpoint);
    if (config.scanEndpoint) {
      return String(config.scanEndpoint).replace(/request-scan(?:\?.*)?$/i, "resolve-steam-game");
    }

    var host = String(global.location.hostname || "").toLowerCase();
    if (host.indexOf("netlify.app") > -1 || host === "localhost" || host === "127.0.0.1") {
      return "/.netlify/functions/resolve-steam-game";
    }

    return "";
  }

  async function fetchLiveResolvedGame(query) {
    var endpoint = getLiveResolverEndpoint();
    if (!endpoint) return null;

    var url;
    try {
      url = new URL(endpoint, global.location.href);
    } catch (error) {
      return null;
    }

    if (query && query.slug) {
      url.searchParams.set("slug", String(query.slug));
    }
    if (query && query.appid) {
      url.searchParams.set("appid", String(query.appid));
    }

    try {
      var response = await fetch(url.toString(), { cache: "no-store" });
      if (!response.ok) return null;
      var payload = await response.json();
      if (!payload || payload.ok !== true || !payload.game) return null;
      return payload;
    } catch (error) {
      return null;
    }
  }

  function integrateLiveGame(game, patches) {
    if (!game || !game.appid) return null;

    var normalized = Object.assign({}, game, {
      bucket: game.bucket || normalizeBucket(game.name),
      slug: game.slug || slugify(game.name),
      live_source: true
    });

    if (!state.searchIndex) {
      state.searchIndex = buildFallbackSearchIndex();
    }
    if (!Array.isArray(state.searchIndex.games)) {
      state.searchIndex.games = [];
    }

    var existingIndex = state.searchIndex.games.findIndex(function findIndex(item) {
      return String(item.appid) === String(normalized.appid);
    });

    if (existingIndex > -1) {
      state.searchIndex.games[existingIndex] = mergeGameWithDepotIndex(Object.assign({}, state.searchIndex.games[existingIndex], normalized));
    } else {
      state.searchIndex.games.push(mergeGameWithDepotIndex(normalized));
    }

    var bucket = normalized.bucket || normalizeBucket(normalized.name);
    if (!state.bucketCache[bucket]) {
      state.bucketCache[bucket] = [];
    }
    var existingBucketIndex = state.bucketCache[bucket].findIndex(function findBucketIndex(item) {
      return String(item.appid) === String(normalized.appid);
    });
    if (existingBucketIndex > -1) {
      state.bucketCache[bucket][existingBucketIndex] = mergeGameWithDepotIndex(Object.assign({}, state.bucketCache[bucket][existingBucketIndex], normalized));
    } else {
      state.bucketCache[bucket].push(mergeGameWithDepotIndex(normalized));
    }

    if (Array.isArray(patches)) {
      state.patchByAppCache[String(normalized.appid)] = patches.slice().sort(byDateDesc);
      if (App.storage) {
        App.storage.cachePatches(String(normalized.appid), patches);
      }
    }

    return mergeGameWithDepotIndex(normalized);
  }

  async function fetchAndCacheLiveGameBySlug(slug) {
    var key = String(slug || "").trim();
    if (!key) return null;
    if (state.liveGameBySlugCache[key]) return state.liveGameBySlugCache[key];

    var payload = await fetchLiveResolvedGame({ slug: key });
    if (!payload || !payload.game) return null;

    var game = integrateLiveGame(payload.game, payload.patches || []);
    if (!game) return null;
    state.liveGameBySlugCache[key] = game;
    state.liveGameByAppIdCache[String(game.appid)] = game;
    return game;
  }

  async function fetchAndCacheLiveGameByAppId(appid) {
    var key = String(appid || "").trim();
    if (!key) return null;
    if (state.liveGameByAppIdCache[key]) return state.liveGameByAppIdCache[key];

    var payload = await fetchLiveResolvedGame({ appid: key });
    if (!payload || !payload.game) return null;

    var game = integrateLiveGame(payload.game, payload.patches || []);
    if (!game) return null;
    state.liveGameByAppIdCache[key] = game;
    state.liveGameBySlugCache[String(game.slug)] = game;
    return game;
  }

  async function ensureSearchIndexLoaded() {
    if (state.searchIndex) return state.searchIndex;

    var fallback = buildFallbackSearchIndex();
    var loaded = await loadJsonFile("./data/search-index.json", fallback);

    state.searchIndex = loaded && Array.isArray(loaded.games) ? loaded : fallback;
    await ensureAppToDepotsIndexLoaded();
    state.searchIndex.games = (state.searchIndex.games || []).map(function mapGame(game) {
      return mergeGameWithDepotIndex(game);
    });
    return state.searchIndex;
  }

  async function ensureAppToDepotsIndexLoaded() {
    if (state.appToDepotsIndex) return state.appToDepotsIndex;

    var fallback = {
      generated_at: "2026-05-14T00:00:00Z",
      apps: {}
    };
    var loaded = await loadJsonFile("./data/app-to-depots-index.json", fallback);
    state.appToDepotsIndex = loaded && typeof loaded === "object" ? loaded : fallback;
    return state.appToDepotsIndex;
  }

  function getAppDepotRecord(appid) {
    if (!state.appToDepotsIndex) return null;
    var key = String(appid || "");
    if (state.appToDepotsIndex[key]) return state.appToDepotsIndex[key];
    if (state.appToDepotsIndex.apps && state.appToDepotsIndex.apps[key]) return state.appToDepotsIndex.apps[key];
    return null;
  }

  function mergeGameWithDepotIndex(game) {
    if (!game || !game.appid) return game;
    var record = getAppDepotRecord(game.appid);
    if (!record) return game;

    var depots = Array.isArray(record.depots) ? record.depots : [];
    var depotids = depots.map(function mapDepot(depot) {
      return String(depot && depot.depotid ? depot.depotid : "").trim();
    }).filter(Boolean);

    return Object.assign({}, game, {
      depots: depots,
      depotids: depotids
    });
  }

  async function loadGamesBucket(bucket) {
    var key = bucket || "0-9";
    if (state.bucketCache[key]) return state.bucketCache[key];

    var fallback = buildFallbackGameBucket(key);
    var loaded = await loadJsonFile("./data/games/" + key + ".json", fallback);

    var games = loaded && Array.isArray(loaded.games) ? loaded.games : fallback.games;
    await ensureAppToDepotsIndexLoaded();
    state.bucketCache[key] = games.map(function mapGame(game) {
      return mergeGameWithDepotIndex(game);
    });
    return state.bucketCache[key];
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

    var manifests = flattenManifestFile(loaded || fallback, key);
    state.manifestsByAppCache[key] = manifests.sort(byDateDesc);
    return state.manifestsByAppCache[key];
  }

  function flattenManifestFile(payload, appid) {
    if (payload && Array.isArray(payload.manifests)) {
      return payload.manifests;
    }

    if (!payload || !Array.isArray(payload.depots)) {
      return buildFallbackManifestsFile(appid).manifests;
    }

    return payload.depots.reduce(function reduceDepots(items, depot) {
      var depotid = depot.depotid;
      var depotName = depot.name || "";
      var os = depot.os || "all";
      var language = depot.language || "all";

      (depot.manifests || []).forEach(function eachManifest(manifest) {
        items.push(Object.assign({}, manifest, {
          appid: Number(appid),
          depotid: manifest.depotid || depotid,
          depot_name: manifest.depot_name || depotName,
          os: manifest.os || os,
          language: manifest.language || language,
          date: manifest.date || manifest.first_seen_at || manifest.last_seen_at,
          notes: manifest.notes || "Manifest connu, téléchargement non garanti.",
          source: manifest.source || "unknown",
          status: manifest.status || "unverified",
          download_command: manifest.download_command || ("download_depot " + appid + " " + (manifest.depotid || depotid) + " " + manifest.manifestid)
        }));
      });

      return items;
    }, []);
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

    if (!finalResults.length && cleanQuery.length >= 3) {
      var liveGame = await fetchAndCacheLiveGameBySlug(slugify(cleanQuery));
      if (liveGame) {
        return [Object.assign({}, liveGame, { search_score: 99 })];
      }
    }

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

    if (!summary) {
      await ensureAppToDepotsIndexLoaded();
      return fetchAndCacheLiveGameBySlug(cleanSlug);
    }

    var bucket = summary.bucket || normalizeBucket(summary.name);
    var bucketGames = await loadGamesBucket(bucket);

    var full = bucketGames.find(function findGame(game) {
      return game.slug === cleanSlug;
    });

    return mergeGameWithDepotIndex(full || summary);
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
    var liveGame = await fetchAndCacheLiveGameByAppId(appid);
    if (!liveGame) {
      return {
        ok: false,
        appid: appid,
        message: "Aucune réponse live Steam disponible pour cet AppID."
      };
    }

    return {
      ok: true,
      appid: appid,
      game: liveGame,
      message: "Fiche live rafraîchie depuis Steam."
    };
  }

  async function refreshNewsFromSteam(appid) {
    var liveGame = await fetchAndCacheLiveGameByAppId(appid);
    if (!liveGame) {
      return {
        ok: false,
        appid: appid,
        message: "News Steam live indisponibles pour cet AppID."
      };
    }

    return {
      ok: true,
      appid: appid,
      patches: (state.patchByAppCache[String(appid)] || []).slice(),
      message: "News Steam live chargées."
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
