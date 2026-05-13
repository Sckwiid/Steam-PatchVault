(function initMockApi(global) {
  "use strict";

  var App = global.SteamPatchArchive = global.SteamPatchArchive || {};

  var FALLBACK_DATA = {
    games: [
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
    ],
    patches: [
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
      },
      {
        id: "patch-sv-3",
        appid: 413150,
        title: "Patch Balance - Croissance artisanale",
        version_detected: "1.5.7b",
        date: "2023-11-14T13:20:00Z",
        type: "balance",
        content: "Ajustements de rendement pour les produits artisanaux.",
        source_url: "https://store.steampowered.com/news/app/413150",
        source_type: "manual",
        keywords: ["balance", "artisan", "economy"]
      },
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
      },
      {
        id: "patch-rw-2",
        appid: 294100,
        title: "Hotfix - Désynchronisations mods",
        version_detected: "1.5.4075",
        date: "2024-04-18T10:15:00Z",
        type: "hotfix",
        content: "Correction de désynchronisations réseau en multijoueur.",
        source_url: "https://store.steampowered.com/news/app/294100",
        source_type: "steam_news",
        keywords: ["multiplayer", "desync", "mods"]
      },
      {
        id: "patch-rw-3",
        appid: 294100,
        title: "Patch contenu - Événements de colonie",
        version_detected: "1.4.3901",
        date: "2023-09-26T08:50:00Z",
        type: "content",
        content: "Nouveaux incidents narratifs et variantes de quêtes.",
        source_url: "https://store.steampowered.com/news/app/294100",
        source_type: "manual",
        keywords: ["quests", "factions", "events"]
      },
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
      },
      {
        id: "patch-vh-2",
        appid: 892970,
        title: "Hotfix réseau - Serveurs dédiés",
        version_detected: "0.218.18",
        date: "2024-05-22T11:00:00Z",
        type: "hotfix",
        content: "Correction de timeouts serveurs dédiés et reprise de session.",
        source_url: "https://store.steampowered.com/news/app/892970",
        source_type: "steam_news",
        keywords: ["network", "dedicated", "timeout"]
      },
      {
        id: "patch-vh-3",
        appid: 892970,
        title: "Patch balance - Arc et stamina",
        version_detected: "0.217.40",
        date: "2024-02-08T14:25:00Z",
        type: "balance",
        content: "Ajustements de consommation de stamina et courbe de dégâts des arcs.",
        source_url: "https://steamcommunity.com/app/892970/allnews",
        source_type: "manual",
        keywords: ["stamina", "bow", "damage"]
      }
    ],
    manifests: [
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
      },
      {
        id: "manifest-sv-2",
        appid: 413150,
        depotid: 413151,
        manifestid: "1900954151077562896",
        buildid: "13698770",
        branch: "public",
        os: "windows",
        language: "all",
        date: "2024-04-02T09:08:00Z",
        patch_note_id: "patch-sv-2",
        confidence_score: 95,
        notes: "Hotfix réseau et crashs corrélé au build publié."
      },
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
      },
      {
        id: "manifest-rw-2",
        appid: 294100,
        depotid: 294101,
        manifestid: "4101599362017079550",
        buildid: "14118832",
        branch: "public",
        os: "windows",
        language: "all",
        date: "2024-04-18T10:19:00Z",
        patch_note_id: "patch-rw-2",
        confidence_score: 94,
        notes: "Hotfix cohérent avec hausse de build mineure."
      },
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
      },
      {
        id: "manifest-vh-2",
        appid: 892970,
        depotid: 892971,
        manifestid: "5553048082701490012",
        buildid: "14555218",
        branch: "public",
        os: "windows",
        language: "all",
        date: "2024-05-22T11:04:00Z",
        patch_note_id: "patch-vh-2",
        confidence_score: 96,
        notes: "Hotfix dédié au réseau, correspondance temporelle forte."
      }
    ]
  };

  var state = {
    games: null,
    patches: null,
    manifests: null
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function byDateDesc(left, right) {
    return new Date(right.date).getTime() - new Date(left.date).getTime();
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
        // Try next candidate.
      }
    }

    return clone(fallbackValue);
  }

  async function ensureLoaded() {
    if (state.games && state.patches && state.manifests) {
      return state;
    }

    var loaded = await Promise.all([
      loadJsonFile("./data/games.sample.json", FALLBACK_DATA.games),
      loadJsonFile("./data/patches.sample.json", FALLBACK_DATA.patches),
      loadJsonFile("./data/manifests.sample.json", FALLBACK_DATA.manifests)
    ]);

    state.games = loaded[0];
    state.patches = loaded[1];
    state.manifests = loaded[2];

    return state;
  }

  async function searchGames(query) {
    var data = await ensureLoaded();
    var search = App.search;

    if (!query || !String(query).trim()) {
      return data.games.slice(0, 12);
    }

    if (!search) {
      return data.games;
    }

    return search.searchGames(data.games, query, { limit: 24, minScore: 26 }).map(function mapEntry(entry) {
      var result = Object.assign({}, entry.game);
      result.search_score = entry.score;
      return result;
    });
  }

  async function getAllGames() {
    var data = await ensureLoaded();
    return data.games.slice();
  }

  async function getGameBySlug(slug) {
    var data = await ensureLoaded();
    var cleanSlug = String(slug || "").trim();
    return data.games.find(function findGame(game) {
      return game.slug === cleanSlug;
    }) || null;
  }

  async function getPatchesByAppId(appid) {
    var data = await ensureLoaded();
    var id = String(appid || "");
    var storage = App.storage;

    if (storage) {
      var cached = storage.getCachedPatches(id);
      if (cached) return cached.slice().sort(byDateDesc);
    }

    var patches = data.patches
      .filter(function filterPatch(patch) {
        return String(patch.appid) === id;
      })
      .sort(byDateDesc);

    if (storage) {
      storage.cachePatches(id, patches);
    }

    return patches;
  }

  async function getManifestsByPatchId(patchId) {
    var data = await ensureLoaded();
    return data.manifests
      .filter(function filterManifest(manifest) {
        return manifest.patch_note_id === patchId;
      })
      .sort(byDateDesc);
  }

  async function getManifestsByAppId(appid) {
    var data = await ensureLoaded();
    return data.manifests
      .filter(function filterManifest(manifest) {
        return String(manifest.appid) === String(appid);
      })
      .sort(byDateDesc);
  }

  async function refreshGameFromSteam(appid) {
    return {
      ok: false,
      appid: appid,
      message: "Placeholder MVP: branche un backend (Cloudflare Worker/Supabase) pour synchroniser Steam."
    };
  }

  async function refreshNewsFromSteam(appid) {
    return {
      ok: false,
      appid: appid,
      message: "Placeholder MVP: ajouter une source Steam News officielle côté serveur."
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
