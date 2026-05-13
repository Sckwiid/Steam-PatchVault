(function initStorageModule(global) {
  "use strict";

  var App = global.SteamPatchArchive = global.SteamPatchArchive || {};

  var NAMESPACE = "spa:v1:";
  var DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
  var MAX_RECENT_SEARCHES = 10;
  var MAX_RECENT_GAMES = 8;

  var KEYS = {
    recentSearches: "recent-searches",
    recentGames: "recent-games",
    patchCache: "patch-cache",
    preferences: "preferences"
  };

  function safeParse(value) {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch (error) {
      return null;
    }
  }

  function normalizeText(input) {
    return String(input || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function createEnvelope(value, ttlMs) {
    return {
      value: value,
      expiresAt: Date.now() + (typeof ttlMs === "number" ? ttlMs : DEFAULT_TTL_MS)
    };
  }

  function fullKey(key) {
    return NAMESPACE + key;
  }

  function setWithTTL(key, value, ttlMs) {
    try {
      var envelope = createEnvelope(value, ttlMs);
      global.localStorage.setItem(fullKey(key), JSON.stringify(envelope));
      return true;
    } catch (error) {
      return false;
    }
  }

  function getWithTTL(key) {
    try {
      var raw = global.localStorage.getItem(fullKey(key));
      var parsed = safeParse(raw);
      if (!parsed) return null;
      if (typeof parsed.expiresAt === "number" && parsed.expiresAt < Date.now()) {
        global.localStorage.removeItem(fullKey(key));
        return null;
      }
      return parsed.value;
    } catch (error) {
      return null;
    }
  }

  function remove(key) {
    try {
      global.localStorage.removeItem(fullKey(key));
      return true;
    } catch (error) {
      return false;
    }
  }

  function clearExpired() {
    try {
      var keysToDelete = [];
      for (var i = 0; i < global.localStorage.length; i += 1) {
        var key = global.localStorage.key(i);
        if (!key || key.indexOf(NAMESPACE) !== 0) continue;
        var parsed = safeParse(global.localStorage.getItem(key));
        if (!parsed || (typeof parsed.expiresAt === "number" && parsed.expiresAt < Date.now())) {
          keysToDelete.push(key);
        }
      }
      keysToDelete.forEach(function eachKey(key) {
        global.localStorage.removeItem(key);
      });
    } catch (error) {
      // Ignored intentionally: storage cleanup failure should not break the app.
    }
  }

  function getRecentSearches(limit) {
    var list = getWithTTL(KEYS.recentSearches) || [];
    return list.slice(0, typeof limit === "number" ? limit : MAX_RECENT_SEARCHES);
  }

  function addRecentSearch(query) {
    var clean = String(query || "").trim();
    if (!clean) return;

    var existing = getRecentSearches(MAX_RECENT_SEARCHES * 2);
    var normalized = normalizeText(clean);

    var next = [clean].concat(existing.filter(function filterSearch(item) {
      return normalizeText(item) !== normalized;
    }));

    setWithTTL(KEYS.recentSearches, next.slice(0, MAX_RECENT_SEARCHES));
  }

  function getRecentGames(limit) {
    var list = getWithTTL(KEYS.recentGames) || [];
    return list.slice(0, typeof limit === "number" ? limit : MAX_RECENT_GAMES);
  }

  function addRecentGame(game) {
    if (!game || !game.appid) return;

    var snapshot = {
      appid: game.appid,
      slug: game.slug,
      name: game.name,
      header_image: game.header_image || "",
      viewed_at: new Date().toISOString(),
      tags: Array.isArray(game.tags) ? game.tags.slice(0, 3) : []
    };

    var existing = getRecentGames(MAX_RECENT_GAMES * 2);
    var next = [snapshot].concat(existing.filter(function filterGame(item) {
      return String(item.appid) !== String(snapshot.appid);
    }));

    setWithTTL(KEYS.recentGames, next.slice(0, MAX_RECENT_GAMES));
  }

  function getPatchCache() {
    return getWithTTL(KEYS.patchCache) || {};
  }

  function cachePatches(appid, patches) {
    if (!appid || !Array.isArray(patches)) return;
    var cache = getPatchCache();
    cache[String(appid)] = {
      updated_at: new Date().toISOString(),
      patches: patches
    };
    setWithTTL(KEYS.patchCache, cache);
  }

  function getCachedPatches(appid) {
    var cache = getPatchCache();
    var entry = cache[String(appid)];
    if (!entry || !Array.isArray(entry.patches)) return null;
    return entry.patches;
  }

  function getPreferences() {
    return getWithTTL(KEYS.preferences) || {
      quickTag: "",
      reducedMotion: global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches
    };
  }

  function setPreference(name, value) {
    if (!name) return;
    var preferences = getPreferences();
    preferences[name] = value;
    setWithTTL(KEYS.preferences, preferences);
  }

  clearExpired();

  App.storage = {
    TTL_MS: DEFAULT_TTL_MS,
    keys: KEYS,
    setWithTTL: setWithTTL,
    getWithTTL: getWithTTL,
    remove: remove,
    clearExpired: clearExpired,
    getRecentSearches: getRecentSearches,
    addRecentSearch: addRecentSearch,
    getRecentGames: getRecentGames,
    addRecentGame: addRecentGame,
    cachePatches: cachePatches,
    getCachedPatches: getCachedPatches,
    getPreferences: getPreferences,
    setPreference: setPreference
  };
})(window);
