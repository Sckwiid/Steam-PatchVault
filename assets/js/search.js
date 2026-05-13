(function initSearchModule(global) {
  "use strict";

  var App = global.SteamPatchArchive = global.SteamPatchArchive || {};

  var QUICK_TAGS = ["RPG", "Survival", "Indie", "Multiplayer", "Modded", "Speedrun"];

  function normalizeText(input) {
    return String(input || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function uniqueTokens(text) {
    return normalizeText(text)
      .split(" ")
      .filter(Boolean)
      .filter(function distinct(token, index, arr) {
        return arr.indexOf(token) === index;
      });
  }

  function makeBigrams(text) {
    var clean = normalizeText(text).replace(/\s+/g, " ");
    if (clean.length < 2) return [];
    var list = [];
    for (var i = 0; i < clean.length - 1; i += 1) {
      list.push(clean.slice(i, i + 2));
    }
    return list;
  }

  function diceCoefficient(left, right) {
    var a = makeBigrams(left);
    var b = makeBigrams(right);
    if (!a.length || !b.length) return 0;

    var map = Object.create(null);
    a.forEach(function each(pair) {
      map[pair] = (map[pair] || 0) + 1;
    });

    var matches = 0;
    b.forEach(function each(pair) {
      if (map[pair]) {
        map[pair] -= 1;
        matches += 1;
      }
    });

    return (2 * matches) / (a.length + b.length);
  }

  function subsequenceScore(query, target) {
    var q = normalizeText(query);
    var t = normalizeText(target);
    if (!q || !t) return 0;

    var qi = 0;
    for (var i = 0; i < t.length && qi < q.length; i += 1) {
      if (t[i] === q[qi]) qi += 1;
    }
    return qi / q.length;
  }

  function computeGameScore(query, game) {
    var cleanQuery = normalizeText(query);
    if (!cleanQuery) return 0;

    var name = normalizeText(game.name);
    var description = normalizeText(game.description);
    var tags = Array.isArray(game.tags) ? game.tags.join(" ") : "";
    var keywords = [name, description, tags].join(" ");

    if (name === cleanQuery) return 100;
    if (name.indexOf(cleanQuery) === 0) return 97;
    if (name.indexOf(cleanQuery) > -1) return 90;

    var queryTokens = uniqueTokens(cleanQuery);
    var targetTokens = uniqueTokens(keywords);

    var tokenMatches = queryTokens.filter(function hasToken(token) {
      return targetTokens.indexOf(token) > -1;
    }).length;

    var tokenScore = queryTokens.length ? tokenMatches / queryTokens.length : 0;
    var diceScore = diceCoefficient(cleanQuery, keywords);
    var subScore = subsequenceScore(cleanQuery, name);

    return Math.round((tokenScore * 0.45 + diceScore * 0.35 + subScore * 0.2) * 100);
  }

  function searchGames(games, query, opts) {
    var options = opts || {};
    var limit = typeof options.limit === "number" ? options.limit : 12;
    var minScore = typeof options.minScore === "number" ? options.minScore : 28;

    if (!Array.isArray(games)) return [];

    var cleanQuery = normalizeText(query);
    if (!cleanQuery) {
      return games.slice(0, limit).map(function passthrough(game) {
        return { game: game, score: 0 };
      });
    }

    return games
      .map(function mapGame(game) {
        return {
          game: game,
          score: computeGameScore(cleanQuery, game)
        };
      })
      .filter(function filterGame(entry) {
        return entry.score >= minScore;
      })
      .sort(function sortGame(a, b) {
        return b.score - a.score || a.game.name.localeCompare(b.game.name);
      })
      .slice(0, limit);
  }

  function filterGamesByQuickTag(games, tag) {
    var cleanTag = normalizeText(tag);
    if (!cleanTag) return games;
    return (games || []).filter(function filterGame(game) {
      var tags = Array.isArray(game.tags) ? game.tags : [];
      return tags.some(function findTag(item) {
        return normalizeText(item) === cleanTag;
      });
    });
  }

  App.search = {
    QUICK_TAGS: QUICK_TAGS,
    normalizeText: normalizeText,
    searchGames: searchGames,
    filterGamesByQuickTag: filterGamesByQuickTag
  };
})(window);
