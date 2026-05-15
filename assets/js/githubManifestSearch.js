(function initGitHubManifestSearch(global) {
  "use strict";

  var App = global.SteamPatchArchive = global.SteamPatchArchive || {};
  var CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  var CACHE_PREFIX = "github-manifests:";

  var GITHUB_MANIFEST_SOURCES = [
    {
      owner: "qwe213312",
      repo: "k25FCdfEOoEJ42S6",
      branch: "main",
      label: "qwe213312/k25FCdfEOoEJ42S6"
    },
    {
      owner: "mejikuhibiniu1",
      repo: "k25FCdfEOoEJ42S6",
      branch: "main",
      label: "mejikuhibiniu1/k25FCdfEOoEJ42S6"
    },
    {
      owner: "Sainan",
      repo: "k25FCdfEOoEJ42S6",
      branch: "main",
      label: "Sainan/k25FCdfEOoEJ42S6"
    }
  ];

  function safeParse(value) {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch (error) {
      return null;
    }
  }

  function cacheKey(key) {
    return "spa:v1:" + CACHE_PREFIX + key;
  }

  function getCachedGitHubManifestResults(key) {
    try {
      var parsed = safeParse(global.localStorage.getItem(cacheKey(key)));
      if (!parsed || !parsed.fetched_at) return null;
      if (Date.now() - new Date(parsed.fetched_at).getTime() > CACHE_TTL_MS) {
        global.localStorage.removeItem(cacheKey(key));
        return null;
      }
      return parsed;
    } catch (error) {
      return null;
    }
  }

  function setCachedGitHubManifestResults(key, data) {
    try {
      global.localStorage.setItem(cacheKey(key), JSON.stringify({
        results: data.results || [],
        fetched_at: data.fetched_at || new Date().toISOString(),
        partial: Boolean(data.partial),
        sources_checked: Number(data.sources_checked || 0),
        source_summaries: data.source_summaries || []
      }));
      return true;
    } catch (error) {
      return false;
    }
  }

  async function fetchJson(url, options) {
    var response = await fetch(url, {
      signal: options && options.signal,
      cache: "no-store",
      headers: {
        "Accept": "application/vnd.github+json"
      }
    });

    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    return response.json();
  }

  async function fetchGitHubTree(owner, repo, branch, options) {
    var url = "https://api.github.com/repos/" +
      encodeURIComponent(owner) + "/" +
      encodeURIComponent(repo) +
      "/git/trees/" +
      encodeURIComponent(branch || "main") +
      "?recursive=1";

    return fetchJson(url, options || {});
  }

  function parseManifestFilename(path, sourceRepo) {
    var filename = String(path || "").split("/").pop();
    var match = /^(\d+)_(\d+)\.manifest$/.exec(filename);

    if (!match) return null;

    return {
      depotid: match[1],
      manifestid: match[2],
      source_repo: sourceRepo,
      source_type: "github_tree_index",
      status: "unverified",
      confidence_score: 25
    };
  }

  function mergeAndDedupeManifests(results) {
    var seen = Object.create(null);

    return (results || []).filter(function dedupe(item) {
      var key = String(item.depotid || "") + ":" + String(item.manifestid || "");
      if (!item.depotid || !item.manifestid || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  async function loadJsonIfExists(path, signal) {
    try {
      var response = await fetch(path, { cache: "no-store", signal: signal });
      if (!response.ok) return null;
      return response.json();
    } catch (error) {
      if (error && error.name === "AbortError") throw error;
      return null;
    }
  }

  async function loadLocalCommunityManifestIndex(options) {
    return loadJsonIfExists("./data/community-manifest-index.json", options && options.signal);
  }

  async function loadDepotToAppIndex(options) {
    return loadJsonIfExists("./data/depot-to-app-index.json", options && options.signal);
  }

  async function loadAppToDepotsIndex(options) {
    return loadJsonIfExists("./data/app-to-depots-index.json", options && options.signal);
  }

  function collectDepotIdsFromManifestItems(items) {
    var depotIds = Object.create(null);

    (items || []).forEach(function eachManifest(manifest) {
      if (manifest && manifest.depotid) {
        depotIds[String(manifest.depotid)] = true;
      }
    });

    return Object.keys(depotIds);
  }

  function collectDepotIdsFromGame(game) {
    var depotIds = Object.create(null);

    (game.depotids || game.depotIds || []).forEach(function eachDepotId(depotid) {
      depotIds[String(depotid)] = true;
    });

    (game.depots || []).forEach(function eachDepot(depot) {
      if (depot && depot.depotid) depotIds[String(depot.depotid)] = true;
    });

    return Object.keys(depotIds);
  }

  async function resolveDepotIdsForGame(game, options) {
    var depotIds = collectDepotIdsFromGame(game);

    if (App.api && App.api.getManifestsByAppId) {
      try {
        var manifests = await App.api.getManifestsByAppId(game.appid);
        collectDepotIdsFromManifestItems(manifests).forEach(function eachDepotId(depotid) {
          depotIds.push(depotid);
        });
      } catch (error) {
        // Missing local manifest file should not block GitHub search.
      }
    }

    var appid = String(game.appid || "");
    var appToDepots = await loadAppToDepotsIndex(options || {});
    if (appToDepots) {
      var appRecord = appToDepots[appid] || (appToDepots.apps && appToDepots.apps[appid]);
      if (appRecord && Array.isArray(appRecord.depots)) {
        appRecord.depots.forEach(function eachDepot(item) {
          if (item && item.depotid) depotIds.push(String(item.depotid));
        });
      }
    }

    var depotIndex = await loadDepotToAppIndex(options || {});
    if (depotIndex && typeof depotIndex === "object") {
      Object.keys(depotIndex).forEach(function eachDepotId(depotid) {
        var matches = depotIndex[depotid];
        if (!Array.isArray(matches)) return;
        if (matches.some(function hasApp(item) {
          return String(item && item.appid) === appid;
        })) {
          depotIds.push(String(depotid));
        }
      });
    }

    return Array.from(new Set(depotIds.map(String).filter(Boolean)));
  }

  function enrichResult(result, appid, gameName) {
    var next = Object.assign({}, result, {
      appid: appid ? String(appid) : "",
      game_name: gameName || ""
    });

    if (next.appid) {
      next.download_command = "download_depot " + next.appid + " " + next.depotid + " " + next.manifestid;
    }

    return next;
  }

  function filterLocalIndex(index, depotIds, game) {
    var allowed = Object.create(null);
    depotIds.forEach(function eachDepotId(depotid) {
      allowed[String(depotid)] = true;
    });

    var items = Array.isArray(index) ? index : index.manifests || index.results || [];
    if (!items.length && index && index.by_depotid) {
      depotIds.forEach(function eachDepotId(depotid) {
        var bucket = index.by_depotid[String(depotid)];
        if (Array.isArray(bucket)) {
          items = items.concat(bucket);
        }
      });
    }

    return mergeAndDedupeManifests(items.filter(function filterItem(item) {
      return item && allowed[String(item.depotid || "")];
    }).map(function mapItem(item) {
      return enrichResult(Object.assign({
        source_type: "local_community_index",
        source_repo: item.source_repo || "community-manifest-index",
        status: item.status || "unverified",
        confidence_score: item.confidence_score || 35
      }, item), game.appid, game.name);
    }));
  }

  async function searchGitHubManifestsForDepots(depotIds, options) {
    var allowed = Object.create(null);
    var results = [];
    var partial = false;
    var sourcesChecked = 0;
    var sourceSummaries = [];
    var opts = options || {};

    (depotIds || []).map(String).filter(Boolean).forEach(function eachDepotId(depotid) {
      allowed[depotid] = true;
    });

    for (var i = 0; i < GITHUB_MANIFEST_SOURCES.length; i += 1) {
      var source = GITHUB_MANIFEST_SOURCES[i];

      if (opts.signal && opts.signal.aborted) {
        throw new DOMException("Recherche annulée", "AbortError");
      }

      if (typeof opts.onProgress === "function") {
        opts.onProgress({
          step: "tree",
          message: "Lecture de l’arborescence…",
          source: source.label,
          sources_checked: sourcesChecked,
          results: mergeAndDedupeManifests(results)
        });
      }

      try {
        var treePayload = await fetchGitHubTree(source.owner, source.repo, source.branch, { signal: opts.signal });
        sourcesChecked += 1;
        if (treePayload.truncated) partial = true;

        if (typeof opts.onProgress === "function") {
          opts.onProgress({
            step: "filter",
            message: "Filtrage des DepotID…",
            source: source.label,
            sources_checked: sourcesChecked,
            partial: partial,
            results: mergeAndDedupeManifests(results)
          });
        }

        var sourceResults = (treePayload.tree || []).reduce(function reduceTree(items, entry) {
          if (!entry || entry.type !== "blob") return items;
          var parsed = parseManifestFilename(entry.path, source.label);
          if (parsed && allowed[String(parsed.depotid)]) {
            items.push(parsed);
          }
          return items;
        }, []);

        results = mergeAndDedupeManifests(results.concat(sourceResults));
        sourceSummaries.push({
          source: source.label,
          checked: true,
          partial: Boolean(treePayload.truncated),
          found: sourceResults.length
        });

        if (typeof opts.onSourceComplete === "function") {
          opts.onSourceComplete({
            source: source.label,
            source_results: sourceResults,
            results: results,
            partial: partial,
            sources_checked: sourcesChecked,
            source_summaries: sourceSummaries.slice()
          });
        }
      } catch (error) {
        if (error && error.name === "AbortError") throw error;
        sourcesChecked += 1;
        sourceSummaries.push({
          source: source.label,
          checked: false,
          partial: false,
          found: 0,
          error: error.message || "Erreur inconnue"
        });
      }
    }

    if (typeof opts.onProgress === "function") {
      opts.onProgress({
        step: "dedupe",
        message: "Déduplication des manifests…",
        sources_checked: sourcesChecked,
        partial: partial,
        results: results
      });
    }

    return {
      results: mergeAndDedupeManifests(results),
      fetched_at: new Date().toISOString(),
      partial: partial,
      sources_checked: sourcesChecked,
      source_summaries: sourceSummaries
    };
  }

  async function searchGitHubManifestsForGame(game, options) {
    var opts = options || {};
    var cacheKeyValue = String(game && game.appid ? game.appid : "");
    var forceRemote = Boolean(opts.forceRemote);

    if (!opts.ignoreCache && !forceRemote) {
      var cached = getCachedGitHubManifestResults(cacheKeyValue);
      if (cached) {
        return Object.assign({}, cached, { from_cache: true });
      }
    }

    if (typeof opts.onProgress === "function") {
      opts.onProgress({
        step: "connect",
        message: "Connexion à GitHub…",
        sources_checked: 0,
        results: []
      });
    }

    var depotIds = await resolveDepotIdsForGame(game, opts);

    if (!depotIds.length) {
      return {
        results: [],
        fetched_at: new Date().toISOString(),
        partial: false,
        sources_checked: 0,
        source_summaries: [],
        missing_depots: true
      };
    }

    var localIndex = forceRemote ? null : await loadLocalCommunityManifestIndex(opts);
    if (localIndex) {
      var localResults = filterLocalIndex(localIndex, depotIds, game);
      var localPayload = {
        results: localResults,
        fetched_at: new Date().toISOString(),
        partial: false,
        sources_checked: 1,
        source_summaries: [{ source: "community-manifest-index", checked: true, partial: false, found: localResults.length }]
      };
      setCachedGitHubManifestResults(cacheKeyValue, localPayload);
      return localPayload;
    }

    var remote = await searchGitHubManifestsForDepots(depotIds, {
      signal: opts.signal,
      onProgress: opts.onProgress,
      onSourceComplete: function onSourceComplete(payload) {
        payload.results = payload.results.map(function mapResult(item) {
          return enrichResult(item, game.appid, game.name);
        });
        if (typeof opts.onSourceComplete === "function") {
          opts.onSourceComplete(payload);
        }
      }
    });

    remote.results = remote.results.map(function mapResult(item) {
      return enrichResult(item, game.appid, game.name);
    });

    setCachedGitHubManifestResults(cacheKeyValue, remote);
    return remote;
  }

  App.githubManifestSearch = {
    GITHUB_MANIFEST_SOURCES: GITHUB_MANIFEST_SOURCES,
    searchGitHubManifestsForGame: searchGitHubManifestsForGame,
    searchGitHubManifestsForDepots: searchGitHubManifestsForDepots,
    fetchGitHubTree: fetchGitHubTree,
    parseManifestFilename: parseManifestFilename,
    mergeAndDedupeManifests: mergeAndDedupeManifests,
    getCachedGitHubManifestResults: getCachedGitHubManifestResults,
    setCachedGitHubManifestResults: setCachedGitHubManifestResults,
    loadLocalCommunityManifestIndex: loadLocalCommunityManifestIndex
  };
})(window);
