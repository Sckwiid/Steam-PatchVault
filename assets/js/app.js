(function initApplication(global) {
  "use strict";

  var App = global.SteamPatchArchive = global.SteamPatchArchive || {};

  var state = {
    route: { name: "home", path: "/", params: {} },
    allGames: [],
    homeSearchResults: [],
    homeSearchQuery: "",
    homeSearchLoading: false,
    homeSearchRequestId: 0,
    searchQuery: "",
    activeQuickTag: "",
    gameFilters: {
      version: "",
      date: "",
      keyword: "",
      type: "all",
      completeOnly: false
    },
    currentGameSlug: "",
    currentGame: null,
    currentPatches: [],
    selectedPatchId: "",
    patchContentExpanded: false,
    manifestsByPatchId: {},
    currentManifests: [],
    currentAllManifests: [],
    githubManifestSearch: {
      status: "idle",
      message: "Aucune recherche GitHub lancée.",
      results: [],
      partial: false,
      sourcesChecked: 0,
      sourceSummaries: [],
      fromCache: false,
      missingDepots: false,
      controller: null
    },
    mobileDrawerOpen: false,
    scanDispatch: {
      appid: "",
      status: "idle",
      message: "",
      auto: false,
      runId: null,
      runUrl: "",
      pollTimerId: null,
      pollStartedAt: 0
    }
  };

  var root = document.getElementById("app");
  var toastContainer = document.getElementById("toast-container");
  var guideAssets = {
    nonSteamMenu: "https://tse1.mm.bing.net/th/id/OIP.ObomnzvG8JYNOg3bTRbKyQHaDd?pid=Api",
    nonSteamDialog: "https://cdn.mos.cms.futurecdn.net/JesibHpNgqiFpDEjcU3GNA-1200-80.jpg"
  };
  var FEATURED_APPIDS = [739630, 108600, 105600, 413150, 892970, 294100, 489830, 1091500];
  var GITHUB_ISSUES_URL = "https://github.com/Sckwiid/Steam-PatchVault/issues/new";
  var DEFAULT_SCAN_ENDPOINT = "/.netlify/functions/request-scan";
  var DEFAULT_PERSIST_ENDPOINT = "/.netlify/functions/persist-community-manifests";
  var SCAN_REQUEST_COOLDOWN_MS = 6 * 60 * 60 * 1000;
  var SCAN_AUTO_COOLDOWN_MS = 24 * 60 * 60 * 1000;
  var SCAN_BURST_THROTTLE_MS = 45 * 1000;
  var AUTO_GITHUB_SEARCH_COOLDOWN_MS = 6 * 60 * 60 * 1000;
  var AUTO_STEAM_REFRESH_COOLDOWN_MS = 2 * 60 * 60 * 1000;
  var PERSIST_COMMUNITY_COOLDOWN_MS = 15 * 60 * 1000;
  var SCAN_STATUS_POLL_INTERVAL_MS = 8000;
  var SCAN_STATUS_MAX_POLL_MS = 10 * 60 * 1000;
  var scanInFlightByAppId = Object.create(null);

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDate(isoValue) {
    var date = new Date(isoValue);
    if (Number.isNaN(date.getTime())) return "Date inconnue";
    return new Intl.DateTimeFormat("fr-FR", {
      year: "numeric",
      month: "short",
      day: "2-digit"
    }).format(date);
  }

  function formatDateTime(isoValue) {
    var date = new Date(isoValue);
    if (Number.isNaN(date.getTime())) return "Date inconnue";
    return new Intl.DateTimeFormat("fr-FR", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function typeLabel(type) {
    var labels = {
      major: "Majeur",
      minor: "Mineur",
      hotfix: "Hotfix",
      balance: "Balance",
      content: "Contenu"
    };
    return labels[type] || "Patch";
  }

  function showToast(message, kind) {
    if (!toastContainer) return;
    var toast = document.createElement("div");
    toast.className = "toast toast-" + (kind || "info");
    toast.textContent = message;
    toastContainer.appendChild(toast);

    requestAnimationFrame(function nextFrame() {
      toast.classList.add("is-visible");
    });

    setTimeout(function hideToast() {
      toast.classList.remove("is-visible");
      setTimeout(function removeToast() {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 280);
    }, 2400);
  }

  function pulseButton(button, nextLabel, resetLabel) {
    if (!button) return;
    var original = resetLabel || button.textContent;
    button.textContent = nextLabel;
    button.classList.add("is-success");
    setTimeout(function restore() {
      button.textContent = original;
      button.classList.remove("is-success");
    }, 1400);
  }

  function SearchBar(value, compact) {
    return "" +
      '<div class="search-shell ' + (compact ? "search-shell-compact" : "") + '">' +
      '<label for="home-search" class="sr-only">Rechercher un jeu Steam</label>' +
      '<input id="home-search" class="search-input" type="search" autocomplete="off" placeholder="Rechercher un jeu, ex: Valheim" value="' + escapeHtml(value || "") + '" />' +
      '<span class="search-hint">Recherche instantanée avec tolérance fautes</span>' +
      "</div>";
  }

  function GameResultCard(game) {
    var tags = Array.isArray(game.tags) ? game.tags : [];
    return "" +
      '<article class="game-card" data-action="open-game" data-slug="' + escapeHtml(game.slug) + '">' +
      '<div class="game-card-media">' +
      '<img loading="lazy" src="' + escapeHtml(game.header_image || "") + '" alt="Header ' + escapeHtml(game.name) + '" />' +
      "</div>" +
      '<div class="game-card-content">' +
      '<h3>' + escapeHtml(game.name) + "</h3>" +
      '<p class="muted">' + escapeHtml(game.description || "") + "</p>" +
      '<p class="mono">AppID ' + escapeHtml(game.appid) + "</p>" +
      '<div class="tag-row">' + tags.map(function mapTag(tag) {
        return '<span class="tag-pill">' + escapeHtml(tag) + "</span>";
      }).join("") + "</div>" +
      "</div>" +
      "</article>";
  }

  function EmptyState(title, description) {
    return "" +
      '<div class="empty-state">' +
      '<p class="empty-title">' + escapeHtml(title) + "</p>" +
      '<p class="muted">' + escapeHtml(description) + "</p>" +
      "</div>";
  }

  function RecentGames(items) {
    if (!items.length) {
      return EmptyState("Aucun jeu récemment consulté", "Ta navigation apparaîtra ici après ouverture d'une fiche jeu.");
    }

    return "" +
      '<div class="recent-grid">' +
      items.map(function mapGame(game) {
        return "" +
          '<button class="recent-card" data-action="open-game" data-slug="' + escapeHtml(game.slug) + '" aria-label="Ouvrir ' + escapeHtml(game.name) + '">' +
          '<img src="' + escapeHtml(game.header_image || "") + '" alt="" loading="lazy" />' +
          '<span class="recent-name">' + escapeHtml(game.name) + "</span>" +
          '<span class="mono recent-appid">AppID ' + escapeHtml(game.appid) + "</span>" +
          "</button>";
      }).join("") +
      "</div>";
  }

  function getFeaturedGames(games) {
    var byAppId = Object.create(null);
    (games || []).forEach(function eachGame(game) {
      if (game && game.appid) byAppId[String(game.appid)] = game;
    });

    var featured = FEATURED_APPIDS.map(function mapAppId(appid) {
      return byAppId[String(appid)];
    }).filter(Boolean);

    if (featured.length >= 8) {
      return featured.slice(0, 8);
    }

    (games || []).some(function fillGame(game) {
      if (!game || !game.appid || byAppId["featured-" + game.appid]) return false;
      if (FEATURED_APPIDS.indexOf(Number(game.appid)) === -1) {
        featured.push(game);
        byAppId["featured-" + game.appid] = true;
      }
      return featured.length >= 8;
    });

    return featured.slice(0, 8);
  }

  function ConfidenceBadge(score) {
    var numeric = Number(score || 0);
    var level = "low";
    if (numeric >= 85) level = "high";
    else if (numeric >= 60) level = "mid";

    return '<span class="confidence confidence-' + level + '">Confiance ' + escapeHtml(numeric) + "/100</span>";
  }

  function ManifestStatusBadges(manifest) {
    var badges = [];
    var source = String(manifest.source || manifest.source_type || "").toLowerCase();
    var status = String(manifest.status || "unverified").toLowerCase();

    if (source.indexOf("steam_appinfo") > -1 || source.indexOf("snapshot") > -1) {
      badges.push('<span class="manifest-badge badge-auto">Détecté automatiquement</span>');
    }

    if (status === "confirmed" || status === "community_confirmed" || source === "community") {
      badges.push('<span class="manifest-badge badge-community">Confirmé communauté</span>');
    }

    if (status === "community_unverified" || source.indexOf("github") > -1) {
      badges.push('<span class="manifest-badge badge-community">Communautaire non vérifié</span>');
    }

    if (status !== "confirmed" && status !== "community_confirmed") {
      badges.push('<span class="manifest-badge badge-unguaranteed">Non garanti</span>');
    }

    return badges.join("");
  }

  function buildContributionUrl(type, game, manifest) {
    var title = type === "invalid"
      ? "[Manifest invalide] " + game.name + " (" + game.appid + ")"
      : "[Manifest proposé] " + game.name + " (" + game.appid + ")";

    var body = type === "invalid"
      ? [
        "Manifest à vérifier:",
        "",
        "- AppID: " + game.appid,
        "- DepotID: " + (manifest && manifest.depotid ? manifest.depotid : ""),
        "- ManifestID: " + (manifest && manifest.manifestid ? manifest.manifestid : ""),
        "- Problème constaté:",
        "- Source / preuve:"
      ].join("\n")
      : [
        "Manifest proposé:",
        "",
        "- AppID: " + game.appid,
        "- DepotID:",
        "- ManifestID:",
        "- BuildID:",
        "- Branche: public",
        "- OS: windows / linux / macos / all",
        "- Langue: all",
        "- Date estimée:",
        "- Patch note liée si connue:",
        "- Source / preuve:",
        "- Notes:"
      ].join("\n");

    return GITHUB_ISSUES_URL + "?title=" + encodeURIComponent(title) + "&body=" + encodeURIComponent(body);
  }

  function buildScanIssueUrl(game) {
    var title = "[Demande scan appinfo/PICS] " + game.name + " (" + game.appid + ")";
    var body = [
      "Demande de scan appinfo/PICS",
      "",
      "- AppID: " + game.appid,
      "- Jeu: " + game.name,
      "- Raison: aucun DepotID connu ou manifests incomplets",
      "- Contexte: Stratavault GitHub Pages"
    ].join("\n");

    return GITHUB_ISSUES_URL + "?title=" + encodeURIComponent(title) + "&body=" + encodeURIComponent(body);
  }

  function getScanEndpoint() {
    var config = global.STEAM_PATCHVAULT_CONFIG || {};
    if (config.scanEndpoint) return String(config.scanEndpoint);

    var host = String(global.location.hostname || "").toLowerCase();
    if (host.indexOf("netlify.app") > -1 || host === "localhost" || host === "127.0.0.1") {
      return DEFAULT_SCAN_ENDPOINT;
    }

    return "";
  }

  function getScanStatusEndpoint(appid) {
    var endpoint = getScanEndpoint();
    if (!endpoint || !appid) return "";
    var separator = endpoint.indexOf("?") > -1 ? "&" : "?";
    return endpoint + separator + "appid=" + encodeURIComponent(String(appid));
  }

  function getPersistEndpoint() {
    var config = global.STEAM_PATCHVAULT_CONFIG || {};
    if (config.persistManifestsEndpoint) return String(config.persistManifestsEndpoint);
    if (config.scanEndpoint) {
      return String(config.scanEndpoint).replace(/request-scan(?:\?.*)?$/i, "persist-community-manifests");
    }

    var host = String(global.location.hostname || "").toLowerCase();
    if (host.indexOf("netlify.app") > -1 || host === "localhost" || host === "127.0.0.1") {
      return DEFAULT_PERSIST_ENDPOINT;
    }

    return "";
  }

  function getScanStorageKey(appid, bucket) {
    return "scan-request:" + String(bucket || "manual") + ":" + String(appid || "");
  }

  function getScanLock(appid, bucket) {
    if (!App.storage || !App.storage.getWithTTL) return null;
    return App.storage.getWithTTL(getScanStorageKey(appid, bucket));
  }

  function setScanLock(appid, bucket, payload, ttlMs) {
    if (!App.storage || !App.storage.setWithTTL) return;
    App.storage.setWithTTL(getScanStorageKey(appid, bucket), payload || {}, ttlMs);
  }

  function setScanDispatchState(nextState) {
    state.scanDispatch = Object.assign({}, state.scanDispatch, nextState || {});
  }

  function clearScanStatusPolling() {
    if (state.scanDispatch && state.scanDispatch.pollTimerId) {
      clearTimeout(state.scanDispatch.pollTimerId);
    }
    setScanDispatchState({ pollTimerId: null, pollStartedAt: 0 });
  }

  function formatScanStatusMessage(result, gameName) {
    var name = gameName || "ce jeu";

    if (!result) return "État du scan inconnu.";
    if (result.status === "queued") return "Scan demandé pour " + name + ". Le workflow GitHub est en file d'attente.";
    if (result.status === "already-running") return "Un scan est déjà en cours pour " + name + ".";
    if (result.status === "cooldown") {
      if (result.next_allowed_at) {
        return "Scan en cooldown jusqu’au " + formatDateTime(result.next_allowed_at) + ".";
      }
      return "Scan temporairement limité pour éviter le spam.";
    }
    if (result.status === "blocked") return "Scan bloqué temporairement pour éviter le spam.";
    if (result.status === "error") return "Scan impossible pour le moment. Réessaie plus tard.";
    if (result.status === "in_progress") return "Scan en cours pour " + name + " (workflow GitHub en exécution)…";
    if (result.status === "completed") {
      if (String(result.conclusion || "").toLowerCase() === "success") {
        return "Scan terminé avec succès. Mise à jour des données en cours de propagation.";
      }
      return "Workflow terminé (" + String(result.conclusion || "inconnu") + ").";
    }
    return "Demande de scan envoyée.";
  }

  function CopyButton(command) {
    return '<button class="btn btn-subtle" data-action="copy-command" data-command="' + escapeHtml(command) + '" aria-label="Copier la commande">Copier la commande</button>';
  }

  function SteamConsoleButton(command) {
    return '<button class="btn btn-main" data-action="copy-open-console" data-command="' + escapeHtml(command) + '" aria-label="Copier et ouvrir la console Steam">Copier + ouvrir Steam Console</button>';
  }

  function NonSteamQuickGuide() {
    return "" +
      '<section class="inline-guide">' +
      '<h5>Après le téléchargement</h5>' +
      '<p class="muted">La console Steam affiche le dossier final (ex: <span class="mono">.../steamapps/content/app_XXXX/depot_YYYY</span>). Utilise ce chemin pour retrouver rapidement les fichiers.</p>' +
      '<ol class="inline-steps">' +
      "<li>Ouvre Steam.</li>" +
      "<li>Menu <strong>Jeux</strong> → <strong>Ajouter un jeu non Steam à ma bibliothèque…</strong></li>" +
      "<li>Sélectionne l'exécutable dans le dossier affiché par la console.</li>" +
      "<li>Valide avec <strong>Ajouter les sélections</strong>.</li>" +
      "</ol>" +
      '<button class="btn btn-subtle" data-action="go-non-steam-tutorial" aria-label="Ouvrir le tutoriel jeu non Steam">Ouvrir le tuto pas à pas</button>' +
      "</section>";
  }

  function NonSteamTutorialSection() {
    return "" +
      '<section class="notes-box non-steam-tutorial">' +
      '<h2>Ajouter le raccourci d’un jeu non Steam</h2>' +
      '<ol class="tutorial-steps">' +
      "<li>Lance Steam.</li>" +
      "<li>Clique sur le menu Jeux puis sélectionne Ajouter un jeu non Steam à ma bibliothèque…</li>" +
      "<li>Parcours les jeux installés sur ton ordinateur ou coche les jeux que tu veux ajouter à ta bibliothèque.</li>" +
      "<li>Clique sur Ajouter les sélections.</li>" +
      "</ol>" +
      '<div class="tutorial-media-grid">' +
      '<figure class="tutorial-media">' +
      '<img loading="lazy" decoding="async" width="474" height="279" src="' + escapeHtml(guideAssets.nonSteamMenu) + '" alt="Menu Steam Jeux puis Ajouter un jeu non Steam" />' +
      "<figcaption>Étape menu Steam.</figcaption>" +
      "</figure>" +
      '<figure class="tutorial-media">' +
      '<img loading="lazy" decoding="async" width="1224" height="860" src="' + escapeHtml(guideAssets.nonSteamDialog) + '" alt="Fenêtre Steam Ajouter un jeu" />' +
      "<figcaption>Sélection de l'exécutable à ajouter.</figcaption>" +
      "</figure>" +
      "</div>" +
      '<p class="muted">Astuce: quand <span class="mono">download_depot</span> se termine, Steam affiche un chemin du type <span class="mono">Steam/steamapps/content/app_.../depot_...</span>. C’est la source à cibler.</p>' +
      "</section>";
  }

  function CommandBox(appid, manifest) {
    var command = manifest.download_command || App.steamCommands.buildDownloadCommand(appid, manifest.depotid, manifest.manifestid);
    return "" +
      '<article class="command-box">' +
      '<div class="command-meta">' +
      '<span class="mono">Depot ' + escapeHtml(manifest.depotid) + "</span>" +
      '<span class="mono">Manifest ' + escapeHtml(manifest.manifestid) + "</span>" +
      '<span class="mono">Build ' + escapeHtml(manifest.buildid) + "</span>" +
      "</div>" +
      '<p class="command-artifact mono">' + escapeHtml(command) + "</p>" +
      '<div class="command-actions">' +
      CopyButton(command) +
      SteamConsoleButton(command) +
      "</div>" +
      NonSteamQuickGuide() +
      '<div class="command-fallback" hidden>' +
      '<p class="muted">Copie bloquée: sélectionne la commande manuellement ci-dessus, ou utilise le bouton ci-dessous.</p>' +
      '<button class="btn btn-subtle" data-action="copy-command" data-command="' + escapeHtml(command) + '">Copie manuelle</button>' +
      "</div>" +
      '<div class="console-help" hidden>' +
      '<p class="muted">Colle la commande avec Ctrl+V puis appuie sur Entrée.</p>' +
      '<ul class="help-list">' + App.steamCommands.getSteamConsoleFallbackTips().map(function mapTip(tip) {
        return "<li>" + escapeHtml(tip) + "</li>";
      }).join("") + "</ul>" +
      "</div>" +
      "</article>";
  }

  function getKnownDepotIds(game, manifests) {
    var seen = Object.create(null);
    (game && (game.depotids || game.depotIds) || []).forEach(function eachDepotId(depotid) {
      if (depotid) seen[String(depotid)] = true;
    });
    (game && game.depots || []).forEach(function eachDepot(depot) {
      if (depot && depot.depotid) seen[String(depot.depotid)] = true;
    });
    (manifests || []).forEach(function eachManifest(manifest) {
      if (manifest && manifest.depotid) {
        seen[String(manifest.depotid)] = true;
      }
    });
    return Object.keys(seen);
  }

  function KnownDepotsPanel(game, knownDepotIds) {
    var depots = (game && Array.isArray(game.depots)) ? game.depots : [];
    var hasKnown = knownDepotIds.length > 0;

    var content = hasKnown
      ? '<p class="muted">DepotID connus: <span class="mono">' + escapeHtml(knownDepotIds.join(", ")) + "</span></p>" +
        (depots.length ? '<div class="depot-chip-row">' + depots.map(function mapDepot(depot) {
          return '<span class="depot-chip mono">' + escapeHtml(depot.depotid) + " · " + escapeHtml(depot.depot_name || depot.name || "Depot") + "</span>";
        }).join("") + "</div>" : "")
      : '<p class="muted">Aucun DepotID connu pour ce jeu. Il faut scanner son appinfo/PICS.</p>';

    var currentAppId = String(game && game.appid ? game.appid : "");
    var isCurrentGameScan = String(state.scanDispatch.appid || "") === currentAppId;
    var scanStatus = isCurrentGameScan ? String(state.scanDispatch.status || "idle") : "idle";
    var scanLoading = scanStatus === "loading" || scanStatus === "queued" || scanStatus === "in_progress";
    var scanConfigured = Boolean(getScanEndpoint());
    var scanMessage = isCurrentGameScan ? state.scanDispatch.message : "";
    var runLinkHtml = isCurrentGameScan && state.scanDispatch.runUrl
      ? '<a class="scan-run-link" href="' + escapeHtml(state.scanDispatch.runUrl) + '" target="_blank" rel="noopener noreferrer">Voir le run GitHub</a>'
      : "";
    var scanLoaderHtml = scanLoading
      ? '<div class="scan-progress"><div class="monolith-loader" aria-hidden="true"><span></span></div><div class="loader-bar"></div></div>'
      : "";
    var scanNotice = scanMessage
      ? '<p class="scan-request-note is-' + escapeHtml(scanStatus) + '">' + escapeHtml(scanMessage) + "</p>"
      : (scanConfigured ? "" : '<p class="scan-request-note is-warning">Scan live non configuré ici. Le bouton ouvrira une issue GitHub.</p>');

    return "" +
      '<section class="known-depots-panel">' +
      "<h2>Depots connus du jeu</h2>" +
      content +
      '<div class="known-depots-actions">' +
      '<button class="btn btn-subtle btn-small" data-action="request-scan" data-url="' + escapeHtml(buildScanIssueUrl(game)) + '" ' + (scanLoading ? "disabled" : "") + ">" + (scanLoading ? "Demande en cours…" : "Demander un scan") + "</button>" +
      "</div>" +
      scanNotice +
      runLinkHtml +
      scanLoaderHtml +
      "</section>";
  }

  function GitHubManifestCard(game, manifest) {
    return "" +
      '<article class="github-manifest-card">' +
      '<div class="manifest-head">' +
      '<span class="manifest-badge badge-community">Communautaire non vérifié</span>' +
      '<span class="mono">' + escapeHtml(manifest.source_repo || "GitHub") + "</span>" +
      "</div>" +
      '<p class="mono">Depot ' + escapeHtml(manifest.depotid) + " · Manifest " + escapeHtml(manifest.manifestid) + "</p>" +
      '<p class="muted">ManifestID connu ≠ téléchargement garanti. Source: index GitHub public, contenu du fichier non lu.</p>' +
      CommandBox(game.appid, manifest) +
      "</article>";
  }

  function GitHubManifestSearchPanel(game, knownDepotIds) {
    var search = state.githubManifestSearch;
    var status = search.status;
    var isLoading = status === "loading";
    var title = "Recherche communautaire GitHub";
    var buttonLabel = status === "success" || status === "partial" || status === "empty" || search.fromCache
      ? "Actualiser la recherche GitHub"
      : "Chercher des manifests GitHub";

    var statusText = search.message || "Aucune recherche GitHub lancée.";
    if (status === "partial") {
      statusText = "Résultats partiels : GitHub a tronqué certains index.";
    } else if (status === "success") {
      statusText = search.results.length + " manifests trouvés pour les depots connus de ce jeu.";
    } else if (status === "empty") {
      statusText = search.missingDepots
        ? "Aucun DepotID connu localement pour ce jeu. Ajoute d'abord un depot via import manuel ou index statique."
        : "Aucun manifest communautaire trouvé pour les depots connus.";
    } else if (status === "error") {
      statusText = "Recherche GitHub impossible pour le moment. Réessaie plus tard.";
    }

    var sourceHtml = search.sourceSummaries.length
      ? '<div class="github-source-list">' + search.sourceSummaries.map(function mapSummary(summary) {
        return "" +
          '<span class="github-source-pill ' + (summary.error ? "has-error" : "") + '">' +
          escapeHtml(summary.source) + " · " + escapeHtml(summary.found || 0) + (summary.partial ? " · partiel" : "") +
          "</span>";
      }).join("") + "</div>"
      : "";

    var loaderHtml = isLoading
      ? '<div class="monolith-loader" aria-hidden="true"><span></span></div><div class="loader-bar"></div>'
      : "";

    var resultsHtml = search.results.length
      ? '<div class="github-manifest-grid">' + search.results.map(function mapManifest(manifest) {
        return GitHubManifestCard(game, manifest);
      }).join("") + "</div>"
      : EmptyState("Aucune donnée GitHub affichée", status === "idle" ? "Aucune recherche GitHub lancée." : statusText);

    return "" +
      '<section class="github-search-panel">' +
      '<div class="github-search-head">' +
      '<div>' +
      '<h2>' + title + "</h2>" +
      '<p class="muted">Depots connus: <span class="mono">' + escapeHtml(knownDepotIds.length ? knownDepotIds.join(", ") : "aucun") + "</span></p>" +
      "</div>" +
      '<div class="github-search-actions">' +
      '<button class="btn btn-main" data-action="github-search-manifests" data-ignore-cache="' + (status === "success" || status === "partial" || status === "empty" || search.fromCache ? "true" : "false") + '" ' + (isLoading || !knownDepotIds.length ? "disabled" : "") + ">" + escapeHtml(buttonLabel) + "</button>" +
      (isLoading ? '<button class="btn btn-subtle" data-action="github-cancel-search">Annuler</button>' : "") +
      "</div>" +
      "</div>" +
      '<div class="github-search-status status-' + escapeHtml(status) + '">' +
      loaderHtml +
      '<p>' + escapeHtml(statusText) + "</p>" +
      '<p class="muted">Sources testées: ' + escapeHtml(search.sourcesChecked || 0) + "/" + escapeHtml((App.githubManifestSearch && App.githubManifestSearch.GITHUB_MANIFEST_SOURCES || []).length) + " · Manifests trouvés: " + escapeHtml(search.results.length) + "</p>" +
      sourceHtml +
      "</div>" +
      '<p class="legal-inline">Ces manifests proviennent d’index communautaires publics. Ils ne sont pas vérifiés. ManifestID connu ≠ téléchargement garanti. Vous devez posséder le jeu sur Steam.</p>' +
      resultsHtml +
      "</section>";
  }

  function PatchCard(patch, active) {
    return "" +
      '<article class="patch-card ' + (active ? "is-active" : "") + '" data-action="select-patch" data-patch-id="' + escapeHtml(patch.id) + '">' +
      '<div class="patch-top">' +
      '<span class="patch-type type-' + escapeHtml(patch.type) + '">' + escapeHtml(typeLabel(patch.type)) + "</span>" +
      '<span class="mono">' + escapeHtml(patch.version_detected || "?") + "</span>" +
      "</div>" +
      '<h4>' + escapeHtml(patch.title) + "</h4>" +
      '<p class="muted">' + formatDate(patch.date) + " · Source " + escapeHtml(patch.source_type) + "</p>" +
      '<p class="patch-preview">' + escapeHtml(patch.content).slice(0, 150) + "...</p>" +
      "</article>";
  }

  function PatchTimeline(patches, selectedPatchId) {
    if (!patches.length) {
      return EmptyState("Aucun patch pour ce filtre", "Ajuste les filtres (version, date, mot-clé ou type). ");
    }

    return "" +
      '<div class="patch-timeline">' +
      patches.map(function mapPatch(patch) {
        return PatchCard(patch, patch.id === selectedPatchId);
      }).join("") +
      "</div>";
  }

  function PatchDetailPanel(game, patch, manifests) {
    if (!patch) {
      return "" +
        '<aside class="detail-panel">' +
        EmptyState("Sélectionne un patch", "Choisis une strate dans la timeline pour voir les manifests et commandes.") +
        "</aside>";
    }

    return "" +
      '<aside class="detail-panel">' +
      '<header class="detail-head">' +
      '<p class="mono">Patch ID: ' + escapeHtml(patch.id) + "</p>" +
      '<h3>' + escapeHtml(patch.title) + "</h3>" +
      '<p class="muted">' + formatDateTime(patch.date) + " · " + escapeHtml(typeLabel(patch.type)) + " · Version " + escapeHtml(patch.version_detected || "?") + "</p>" +
      "</header>" +
      '<button class="btn btn-subtle btn-small" data-action="toggle-patch-content" aria-expanded="' + (state.patchContentExpanded ? "true" : "false") + '">' + (state.patchContentExpanded ? "Masquer le patch note" : "Afficher le patch note") + "</button>" +
      (state.patchContentExpanded
        ? '<p class="detail-content">' + escapeHtml(patch.content) + "</p>"
        : '<p class="muted">Patch note masqué par défaut.</p>') +
      '<p class="muted">Source: <a href="' + escapeHtml(patch.source_url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(patch.source_url) + "</a></p>" +
      '<section class="manifest-section">' +
      '<div class="manifest-section-head">' +
      '<h4>Versions téléchargeables</h4>' +
      "</div>" +
      '<p class="manifest-disclaimer">Manifest connu, téléchargement non garanti. Vous devez posséder le jeu sur Steam.</p>' +
      (manifests.length ? manifests.map(function mapManifest(manifest) {
        return "" +
          '<div class="manifest-card">' +
          '<div class="manifest-head">' +
          '<span class="mono">' + escapeHtml((manifest.branch || "public") + " · " + (manifest.os || "all") + " · " + (manifest.language || "all")) + "</span>" +
          "</div>" +
          '<p class="manifest-dates mono">Vu: ' + escapeHtml(formatDateTime(manifest.first_seen_at || manifest.date)) + " → " + escapeHtml(formatDateTime(manifest.last_seen_at || manifest.date)) + "</p>" +
          '<p class="muted">' + escapeHtml(manifest.notes || "") + "</p>" +
          CommandBox(game.appid, manifest) +
          '<button class="btn btn-subtle btn-small" data-action="report-manifest" data-url="' + escapeHtml(buildContributionUrl("invalid", game, manifest)) + '">Signaler manifest invalide</button>' +
          "</div>";
      }).join("") : EmptyState("Aucun manifest lié", "Ce patch n'a pas d'association exploitable pour le moment.")) +
      "</section>" +
      '<section class="legal-warning">' +
      '<p>Vous devez posséder le jeu sur Steam. Ce site ne fournit aucun fichier de jeu.</p>' +
      "</section>" +
      "</aside>";
  }

  function TutorialSteps() {
    var steps = [
      "Ouvrir Steam Console: appuie sur Win + R, tape steam://open/console puis valide avec Entrée.",
      "Si rien ne s'ouvre: ferme Steam puis relance-le avec l'option -console.",
      "Coller la commande download_depot.",
      "Attendre la fin du téléchargement.",
      "Trouver le dossier téléchargé par Steam.",
      "Sauvegarder les fichiers actuels du jeu.",
      "Remplacer/copier les fichiers avec prudence.",
      "Désactiver les mises à jour automatiques si nécessaire.",
      "Restaurer les fichiers originaux en cas de problème."
    ];

    return "" +
      '<ol class="tutorial-steps">' +
      steps.map(function mapStep(step) {
        return "<li>" + escapeHtml(step) + "</li>";
      }).join("") +
      "</ol>";
  }

  function layout(content) {
    return "" +
      '<div class="app-shell">' +
      '<header class="topbar">' +
      '<button class="brand" data-action="go-home" aria-label="Aller à l\'accueil">Steam PatchVault</button>' +
      '<nav class="navlinks">' +
      '<button data-action="go-home">Accueil</button>' +
      '<button data-action="go-tutorial">Tutoriel</button>' +
      '<button data-action="go-about">À propos</button>' +
      "</nav>" +
      "</header>" +
      '<main class="page">' + content + "</main>" +
      '<footer class="site-footer">' +
      '<p>Steam PatchVault · Métadonnées uniquement · Aucun contournement DRM</p>' +
      "</footer>" +
      "</div>";
  }

  function renderHome() {
    var storage = App.storage;
    var allGames = state.allGames;
    var sourceGames = state.searchQuery && state.homeSearchQuery === state.searchQuery
      ? state.homeSearchResults
      : allGames;
    var filteredByTag = state.activeQuickTag ? App.search.filterGamesByQuickTag(sourceGames, state.activeQuickTag) : sourceGames;

    var results = [];
    if (state.searchQuery && state.homeSearchLoading) {
      results = [];
    } else if (state.searchQuery) {
      results = filteredByTag.slice(0, 12);
    } else {
      results = getFeaturedGames(filteredByTag);
    }

    var recentGames = storage.getRecentGames(6);
    var recentSearches = storage.getRecentSearches(6);

    var quickTagsHtml = App.search.QUICK_TAGS.map(function mapTag(tag) {
      var active = tag === state.activeQuickTag;
      return '<button class="tag-chip ' + (active ? "is-active" : "") + '" data-action="set-quick-tag" data-tag="' + escapeHtml(tag) + '">' + escapeHtml(tag) + "</button>";
    }).join("");

    var resultsHtml = state.searchQuery && state.homeSearchLoading
      ? EmptyState("Recherche en cours", "Chargement de l'index local et du bucket correspondant.")
      : results.length
      ? '<div class="results-grid">' + results.map(GameResultCard).join("") + "</div>"
      : EmptyState("Aucun jeu trouvé", "Essaie un autre mot-clé, une version approximative du nom ou retire un tag rapide.");

    var activeTagInfo = state.activeQuickTag
      ? '<p class="muted">Filtre actif: <span class="mono">' + escapeHtml(state.activeQuickTag) + '</span> <button class="inline-link" data-action="clear-quick-tag">retirer</button></p>'
      : "";

    var searchHistoryHtml = recentSearches.length
      ? '<p class="muted">Recherches récentes: ' + recentSearches.map(function mapQuery(item) {
        return '<button class="inline-link" data-action="reuse-search" data-query="' + escapeHtml(item) + '">' + escapeHtml(item) + "</button>";
      }).join(" · ") + "</p>"
      : "";

    var resultsTitle = state.searchQuery ? "Résultats" : "Jeux populaires";

    var content = "" +
      '<section class="hero">' +
      '<p class="hero-kicker mono">Monolith Archive</p>' +
      '<h1>Retrouve l’ancienne version d’un jeu Steam.</h1>' +
      '<p class="lead">Patch notes, manifests et commandes Steam Console au même endroit.</p>' +
      SearchBar(state.searchQuery, false) +
      '<div class="quick-tags">' + quickTagsHtml + "</div>" +
      activeTagInfo +
      searchHistoryHtml +
      "</section>" +
      '<section class="home-section">' +
      '<h2>' + resultsTitle + "</h2>" +
      resultsHtml +
      "</section>" +
      '<section class="home-section">' +
      '<h2>Comment ça marche</h2>' +
      '<div class="how-grid">' +
      '<article><p class="step-index">01</p><h3>Recherche un jeu</h3><p>Récupère AppID, timeline de patchs et sources.</p></article>' +
      '<article><p class="step-index">02</p><h3>Choisis un patch</h3><p>Filtre version/date/type puis vérifie le score de confiance.</p></article>' +
      '<article><p class="step-index">03</p><h3>Copie la commande</h3><p>Colle dans Steam Console sans exécution automatique locale.</p></article>' +
      "</div>" +
      "</section>" +
      '<section class="home-section">' +
      '<h2>Jeux récemment consultés</h2>' +
      RecentGames(recentGames) +
      "</section>" +
      '<section class="home-section">' +
      '<h2>Pourquoi ce site existe</h2>' +
      '<p>Ce projet aide les joueurs, moddeurs et speedrunners à retrouver des strates de versions sans centraliser de fichiers binaires. Il n\'utilise que des métadonnées (AppID, DepotID, ManifestID, dates, sources) et ne contourne ni DRM ni authentification Steam.</p>' +
      "</section>";

    root.innerHTML = layout(content);
  }

  function restoreSearchFocus(cursor) {
    var input = root.querySelector("#home-search");
    if (!input) return;

    input.focus();
    var position = typeof cursor === "number" ? cursor : input.value.length;
    input.setSelectionRange(position, position);
  }

  async function refreshHomeSearch(cursor) {
    var query = String(state.searchQuery || "").trim();
    var requestId = state.homeSearchRequestId + 1;
    state.homeSearchRequestId = requestId;

    if (!query) {
      state.homeSearchResults = [];
      state.homeSearchQuery = "";
      state.homeSearchLoading = false;
      renderHome();
      restoreSearchFocus(cursor);
      return;
    }

    state.homeSearchLoading = true;
    renderHome();
    restoreSearchFocus(cursor);

    var results = await App.api.searchGames(query);
    if (requestId !== state.homeSearchRequestId || state.route.name !== "home") return;

    state.homeSearchResults = results;
    state.homeSearchQuery = state.searchQuery;
    state.homeSearchLoading = false;
    renderHome();
    restoreSearchFocus();
  }

  function patchHasCompleteData(patch) {
    if (!patch || !patch.id) return false;
    return (state.currentAllManifests || []).some(function matchManifest(manifest) {
      return (
        String(manifest.patch_note_id || "") === String(patch.id) &&
        /^\d+$/.test(String(manifest.depotid || "")) &&
        /^\d+$/.test(String(manifest.manifestid || ""))
      );
    });
  }

  function applyPatchFilters(patches) {
    return patches.filter(function filterPatch(patch) {
      var okVersion = !state.gameFilters.version || String(patch.version_detected || "").toLowerCase().indexOf(state.gameFilters.version.toLowerCase()) > -1;

      var okDate = true;
      if (state.gameFilters.date) {
        var patchDate = new Date(patch.date);
        var filterDate = new Date(state.gameFilters.date + "T00:00:00");
        okDate = patchDate >= filterDate;
      }

      var okType = state.gameFilters.type === "all" || patch.type === state.gameFilters.type;

      var keyword = String(state.gameFilters.keyword || "").trim().toLowerCase();
      var patchText = [patch.title, patch.content, (patch.keywords || []).join(" ")].join(" ").toLowerCase();
      var okKeyword = !keyword || patchText.indexOf(keyword) > -1;
      var okComplete = !state.gameFilters.completeOnly || patchHasCompleteData(patch);

      return okVersion && okDate && okType && okKeyword && okComplete;
    });
  }

  async function ensureManifestsForPatch(patchId, appid) {
    if (!patchId) return [];
    if (state.manifestsByPatchId[patchId]) return state.manifestsByPatchId[patchId];

    var manifests = await App.api.getManifestsByPatchId(patchId, appid);
    state.manifestsByPatchId[patchId] = manifests;
    return manifests;
  }

  async function renderGame(route) {
    var slug = route.params.slug;

    if (state.currentGameSlug !== slug) {
      clearScanStatusPolling();
      state.currentGameSlug = slug;
      state.currentGame = null;
      state.currentPatches = [];
      state.selectedPatchId = "";
      state.patchContentExpanded = false;
      state.manifestsByPatchId = {};
      state.currentManifests = [];
      state.currentAllManifests = [];
      state.githubManifestSearch = {
        status: "idle",
        message: "Aucune recherche GitHub lancée.",
        results: [],
        partial: false,
        sourcesChecked: 0,
        sourceSummaries: [],
        fromCache: false,
        missingDepots: false,
        controller: null
      };
      state.scanDispatch = {
        appid: "",
        status: "idle",
        message: "",
        auto: false,
        runId: null,
        runUrl: "",
        pollTimerId: null,
        pollStartedAt: 0
      };
      state.mobileDrawerOpen = false;
      state.gameFilters = {
        version: "",
        date: "",
        keyword: "",
        type: "all",
        completeOnly: false
      };
    }

    var game = state.currentGame || await App.api.getGameBySlug(slug);
    if (!game) {
      root.innerHTML = layout('<section class="home-section">' + EmptyState("Jeu introuvable", "Le slug demandé n\'existe pas dans la base locale.") + "</section>");
      return;
    }

    state.currentGame = game;

    if (!state.currentPatches.length) {
      state.currentPatches = await App.api.getPatchesByAppId(game.appid);
    }

    if (!state.currentAllManifests.length) {
      state.currentAllManifests = await App.api.getManifestsByAppId(game.appid);
    }

    App.storage.addRecentGame(game);

    var filteredPatches = applyPatchFilters(state.currentPatches);

    if (!state.selectedPatchId && filteredPatches.length) {
      state.selectedPatchId = filteredPatches[0].id;
    }

    var selectedPatch = filteredPatches.find(function findPatch(item) {
      return item.id === state.selectedPatchId;
    }) || filteredPatches[0] || null;

    if (selectedPatch && selectedPatch.id !== state.selectedPatchId) {
      state.patchContentExpanded = false;
    }

    state.selectedPatchId = selectedPatch ? selectedPatch.id : "";
    state.currentManifests = selectedPatch ? await ensureManifestsForPatch(selectedPatch.id, game.appid) : [];
    var knownDepotIds = getKnownDepotIds(game, state.currentAllManifests);

    var content = "" +
      '<section class="game-hero">' +
      '<div class="game-hero-media">' +
      '<img class="game-hero-image" src="' + escapeHtml(game.header_image || "") + '" alt="Header ' + escapeHtml(game.name) + '" />' +
      "</div>" +
      '<div class="game-hero-meta">' +
      '<p class="mono">AppID ' + escapeHtml(game.appid) + '</p>' +
      '<h1>' + escapeHtml(game.name) + "</h1>" +
      '<p class="muted">' + escapeHtml(game.description || "") + "</p>" +
      '<p class="muted">Dernière synchronisation: ' + formatDateTime(game.last_synced_at) + "</p>" +
      '<p class="legal-inline">Vous devez posséder le jeu sur Steam. Ce site ne fournit aucun fichier de jeu.</p>' +
      "</div>" +
      "</section>" +
      '<section class="filters">' +
      '<label>Version<input type="text" data-filter="version" placeholder="1.6" value="' + escapeHtml(state.gameFilters.version) + '" /></label>' +
      '<label>Date min<input type="date" data-filter="date" value="' + escapeHtml(state.gameFilters.date) + '" /></label>' +
      '<label>Mot-clé<input type="text" data-filter="keyword" placeholder="coop, crash" value="' + escapeHtml(state.gameFilters.keyword) + '" /></label>' +
      '<label>Type<select data-filter="type">' +
      '<option value="all" ' + (state.gameFilters.type === "all" ? "selected" : "") + ">Tous</option>" +
      '<option value="major" ' + (state.gameFilters.type === "major" ? "selected" : "") + ">Majeur</option>" +
      '<option value="minor" ' + (state.gameFilters.type === "minor" ? "selected" : "") + ">Mineur</option>" +
      '<option value="hotfix" ' + (state.gameFilters.type === "hotfix" ? "selected" : "") + ">Hotfix</option>" +
      '<option value="balance" ' + (state.gameFilters.type === "balance" ? "selected" : "") + ">Balance</option>" +
      '<option value="content" ' + (state.gameFilters.type === "content" ? "selected" : "") + ">Contenu</option>" +
      "</select></label>" +
      '<label class="filters-toggle"><input type="checkbox" data-filter="completeOnly" ' + (state.gameFilters.completeOnly ? "checked" : "") + ' />Patches avec données complètes</label>' +
      "</section>" +
      KnownDepotsPanel(game, knownDepotIds) +
      '<section class="game-layout">' +
      '<div class="timeline-col">' +
      '<h2>Timeline des patch notes</h2>' +
      PatchTimeline(filteredPatches, state.selectedPatchId) +
      "</div>" +
      '<div class="detail-col ' + (state.mobileDrawerOpen ? "is-open" : "") + '">' +
      '<button class="drawer-toggle" data-action="toggle-drawer" aria-expanded="' + (state.mobileDrawerOpen ? "true" : "false") + '">' + (state.mobileDrawerOpen ? "Fermer détail patch" : "Ouvrir détail patch") + "</button>" +
      PatchDetailPanel(game, selectedPatch, state.currentManifests) +
      "</div>" +
      "</section>" +
      GitHubManifestSearchPanel(game, knownDepotIds);

    root.innerHTML = layout(content);
    maybeAutoRefreshFromSteam(game).catch(function noop() {});
    maybeAutoRequestScan(game, knownDepotIds).catch(function noop() {});
    maybeAutoRunGitHubSearch(game, knownDepotIds).catch(function noop() {});
  }

  function renderTutorial(mode) {
    var nonSteamFocused = mode === "non-steam";
    var content = "" +
      '<section class="home-section">' +
      '<h1>Tutoriel Steam Console</h1>' +
      '<p class="lead">Procédure prudente: aucune garantie de disponibilité de manifest ou de compatibilité runtime.</p>' +
      (nonSteamFocused ? '<p class="muted">Section ciblée: ajout d’un jeu non Steam depuis les fichiers téléchargés.</p>' : "") +
      TutorialSteps() +
      NonSteamTutorialSection() +
      '<section class="notes-box">' +
      '<h2>Notes importantes</h2>' +
      '<ul class="help-list">' +
      '<li>Certains vieux manifests peuvent ne plus être disponibles.</li>' +
      '<li>Certains jeux ont plusieurs depots.</li>' +
      '<li>Certains jeux nécessitent plusieurs commandes download_depot.</li>' +
      '<li>Les jeux multijoueurs peuvent refuser les anciennes versions.</li>' +
      '<li>Le site ne garantit pas la compatibilité.</li>' +
      "</ul>" +
      "</section>" +
      "</section>";

    root.innerHTML = layout(content);
  }

  function renderAbout() {
    var content = "" +
      '<section class="home-section">' +
      '<h1>À propos</h1>' +
      '<p>Steam PatchVault est un index de métadonnées pour explorer des patch notes, des associations depot/manifest et des commandes Steam Console prêtes à copier.</p>' +
      '<p>Le site ne demande jamais login, mot de passe, cookie ou token Steam. Il n\'héberge pas de fichiers de jeux et ne contourne pas le DRM.</p>' +
      '<p>Architecture prévue pour futur backend: Steam Web API officielle, imports communautaires JSON/CSV, ou cache serveur via Cloudflare Worker/Supabase.</p>' +
      "</section>";

    root.innerHTML = layout(content);
  }

  function renderNotFound() {
    root.innerHTML = layout('<section class="home-section">' + EmptyState("Route inconnue", "Utilise la navigation principale pour revenir à l\'archive.") + "</section>");
  }

  async function renderRoute(route) {
    state.route = route;

    if (route.name !== "game") {
      clearScanStatusPolling();
    }

    if (!state.allGames.length) {
      state.allGames = await App.api.getAllGames();
    }

    if (route.name === "home") {
      if (state.searchQuery) {
        await refreshHomeSearch();
        return;
      }
      renderHome();
      return;
    }
    if (route.name === "game") {
      await renderGame(route);
      return;
    }
    if (route.name === "tutorial") {
      renderTutorial();
      return;
    }
    if (route.name === "tutorial-non-steam") {
      renderTutorial("non-steam");
      return;
    }
    if (route.name === "about") {
      renderAbout();
      return;
    }

    renderNotFound();
  }

  function findParentByClass(element, className) {
    var node = element;
    while (node && node !== root) {
      if (node.classList && node.classList.contains(className)) return node;
      node = node.parentNode;
    }
    return null;
  }

  function setGitHubSearchState(next) {
    state.githubManifestSearch = Object.assign({}, state.githubManifestSearch, next);
  }

  function getAutoGitHubSearchKey(appid) {
    return "auto-github-search:" + String(appid || "");
  }

  function getAutoSteamRefreshKey(appid) {
    return "auto-steam-refresh:" + String(appid || "");
  }

  function getPersistCommunityKey(appid) {
    return "persist-community-manifests:" + String(appid || "");
  }

  function getStorageLock(key) {
    if (!App.storage || !App.storage.getWithTTL) return null;
    return App.storage.getWithTTL(key);
  }

  function setStorageLock(key, payload, ttlMs) {
    if (!App.storage || !App.storage.setWithTTL) return;
    App.storage.setWithTTL(key, payload || {}, ttlMs);
  }

  async function fetchScanWorkflowStatus(appid) {
    var url = getScanStatusEndpoint(appid);
    if (!url) return null;
    try {
      var response = await fetch(url, { method: "GET", cache: "no-store" });
      if (!response.ok) return null;
      var payload = await response.json();
      return payload && payload.ok !== false ? payload : null;
    } catch (error) {
      return null;
    }
  }

  function scheduleScanStatusPolling(game) {
    if (!game || !game.appid) return;

    var appid = String(game.appid);
    clearScanStatusPolling();
    setScanDispatchState({
      appid: appid,
      pollStartedAt: Date.now()
    });

    var tick = async function tick() {
      if (!state.currentGame || String(state.currentGame.appid) !== appid) {
        clearScanStatusPolling();
        return;
      }

      if (!state.scanDispatch || Date.now() - Number(state.scanDispatch.pollStartedAt || 0) > SCAN_STATUS_MAX_POLL_MS) {
        setScanDispatchState({
          status: "cooldown",
          message: "Suivi du scan arrêté (timeout). Vérifie l’onglet Actions GitHub.",
          pollTimerId: null
        });
        await renderGame(state.route);
        return;
      }

      var run = await fetchScanWorkflowStatus(appid);
      if (!run) {
        var retryId = setTimeout(tick, SCAN_STATUS_POLL_INTERVAL_MS);
        setScanDispatchState({ pollTimerId: retryId });
        return;
      }

      var nextState = {
        status: run.status || "queued",
        message: formatScanStatusMessage(run, game.name),
        runId: run.run_id || state.scanDispatch.runId || null,
        runUrl: run.html_url || state.scanDispatch.runUrl || ""
      };
      setScanDispatchState(nextState);
      await renderGame(state.route);

      if (run.status === "completed") {
        clearScanStatusPolling();
        if (String(run.conclusion || "").toLowerCase() === "success") {
          showToast("Workflow GitHub terminé. Les nouvelles données vont apparaître après refresh Pages.", "success");
        } else {
          showToast("Workflow terminé avec erreur: " + String(run.conclusion || "inconnu"), "warning");
        }
        return;
      }

      var timerId = setTimeout(tick, SCAN_STATUS_POLL_INTERVAL_MS);
      setScanDispatchState({ pollTimerId: timerId });
    };

    var firstTimer = setTimeout(tick, 1500);
    setScanDispatchState({ pollTimerId: firstTimer });
  }

  async function requestRemoteScan(game, options) {
    var opts = options || {};
    var appid = String(game && game.appid ? game.appid : "").trim();
    if (!/^\d+$/.test(appid)) {
      return { ok: false, status: "error", reason: "invalid_appid" };
    }

    var endpoint = getScanEndpoint();
    if (!endpoint) {
      return { ok: false, status: "error", reason: "missing_endpoint" };
    }

    if (scanInFlightByAppId[appid]) {
      return {
        ok: true,
        status: "already-running",
        message: formatScanStatusMessage({ status: "already-running" }, game.name)
      };
    }

    var lockBucket = opts.auto ? "auto" : "manual";
    var defaultCooldownMs = opts.auto ? SCAN_AUTO_COOLDOWN_MS : SCAN_REQUEST_COOLDOWN_MS;
    var burstLock = getScanLock(appid, "burst");
    if (burstLock && !opts.force) {
      return {
        ok: true,
        status: "blocked",
        message: formatScanStatusMessage({ status: "blocked" }, game.name)
      };
    }

    var cooldownLock = getScanLock(appid, lockBucket);
    if (cooldownLock && !opts.force) {
      return {
        ok: true,
        status: "cooldown",
        next_allowed_at: cooldownLock.next_allowed_at || null,
        message: formatScanStatusMessage({ status: "cooldown", next_allowed_at: cooldownLock.next_allowed_at }, game.name)
      };
    }

    setScanLock(appid, "burst", { requested_at: new Date().toISOString() }, SCAN_BURST_THROTTLE_MS);
    scanInFlightByAppId[appid] = true;

    setScanDispatchState({
      appid: appid,
      status: "loading",
      message: opts.auto ? "Scan auto: envoi de la demande…" : "Envoi de la demande de scan…",
      auto: Boolean(opts.auto)
    });

    if (!opts.silent && state.route.name === "game" && String(state.currentGame && state.currentGame.appid) === appid) {
      await renderGame(state.route);
    }

    try {
      var response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appid: appid,
          game_name: String(game.name || ""),
          auto: Boolean(opts.auto),
          source: "steam-patchvault-web"
        })
      });

      var payload = {};
      try {
        payload = await response.json();
      } catch (error) {
        payload = {};
      }

      if (!response.ok) {
        return {
          ok: false,
          status: "error",
          reason: "http_error",
          message: payload.error || ("HTTP " + response.status)
        };
      }

      var returnedCooldownMs = Number(payload.cooldown_ms || 0);
      var effectiveCooldownMs = returnedCooldownMs > 0 ? returnedCooldownMs : defaultCooldownMs;
      if (payload.status === "queued" || payload.status === "already-running" || payload.status === "cooldown") {
        var nextAllowedAtIso = new Date(Date.now() + effectiveCooldownMs).toISOString();
        setScanLock(appid, lockBucket, {
          next_allowed_at: payload.next_allowed_at || nextAllowedAtIso,
          status: payload.status
        }, effectiveCooldownMs);
      }

      return {
        ok: true,
        status: payload.status || "queued",
        run_id: payload.run_id || null,
        html_url: payload.html_url || "",
        next_allowed_at: payload.next_allowed_at || null,
        cooldown_ms: effectiveCooldownMs,
        message: formatScanStatusMessage({
          status: payload.status || "queued",
          next_allowed_at: payload.next_allowed_at || null
        }, game.name)
      };
    } catch (error) {
      return {
        ok: false,
        status: "error",
        reason: error && error.name === "AbortError" ? "aborted" : "network_error",
        message: "Impossible de contacter le service de scan."
      };
    } finally {
      scanInFlightByAppId[appid] = false;
    }
  }

  function sanitizeCommunityManifestRows(game, results) {
    var appid = String(game && game.appid ? game.appid : "");
    return (results || [])
      .map(function mapRow(item) {
        var depotid = String(item && item.depotid ? item.depotid : "").trim();
        var manifestid = String(item && item.manifestid ? item.manifestid : "").trim();
        if (!/^\d+$/.test(depotid) || !/^\d+$/.test(manifestid)) return null;

        return {
          appid: appid,
          game_name: String(game && game.name ? game.name : ""),
          depotid: depotid,
          manifestid: manifestid,
          source_repo: String(item && item.source_repo ? item.source_repo : ""),
          source_type: String(item && item.source_type ? item.source_type : "github_tree_index"),
          status: String(item && item.status ? item.status : "community_unverified"),
          confidence_score: Number(item && item.confidence_score ? item.confidence_score : 25)
        };
      })
      .filter(Boolean);
  }

  async function persistCommunityManifestResults(game, payload, options) {
    var opts = options || {};
    if (!game || !game.appid || !payload || !Array.isArray(payload.results) || !payload.results.length) {
      return { ok: true, status: "no_results", skipped: true };
    }

    var endpoint = getPersistEndpoint();
    if (!endpoint) {
      return { ok: false, status: "error", reason: "missing_endpoint" };
    }

    var appid = String(game.appid);
    var lockKey = getPersistCommunityKey(appid);
    if (!opts.force && getStorageLock(lockKey)) {
      return { ok: true, status: "cooldown", skipped: true };
    }

    var rows = sanitizeCommunityManifestRows(game, payload.results);
    if (!rows.length) {
      return { ok: true, status: "no_valid_rows", skipped: true };
    }

    try {
      var response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appid: appid,
          game_name: String(game.name || ""),
          results: rows,
          source_summaries: payload.source_summaries || []
        })
      });

      var result = {};
      try {
        result = await response.json();
      } catch (error) {
        result = {};
      }

      if (!response.ok) {
        return {
          ok: false,
          status: "error",
          reason: "http_error",
          message: result.error || ("HTTP " + response.status)
        };
      }

      setStorageLock(lockKey, { status: result.status || "ok", updated_at: new Date().toISOString() }, PERSIST_COMMUNITY_COOLDOWN_MS);
      return Object.assign({ ok: true }, result);
    } catch (error) {
      return {
        ok: false,
        status: "error",
        reason: "network_error",
        message: "Push GitHub impossible pour le moment."
      };
    }
  }

  async function applyScanDispatchResult(game, result, options) {
    var opts = options || {};
    if (!game) return;

    var status = result && result.status ? result.status : "error";
    var message = result && result.message ? result.message : formatScanStatusMessage({ status: status }, game.name);
    setScanDispatchState({
      appid: String(game.appid),
      status: status,
      message: message,
      auto: Boolean(opts.auto),
      runId: result && result.run_id ? result.run_id : (state.scanDispatch && state.scanDispatch.runId ? state.scanDispatch.runId : null),
      runUrl: result && result.html_url ? result.html_url : (state.scanDispatch && state.scanDispatch.runUrl ? state.scanDispatch.runUrl : "")
    });

    if (state.route.name === "game" && state.currentGame && String(state.currentGame.appid) === String(game.appid)) {
      await renderGame(state.route);
    }

    if (status === "queued" || status === "already-running" || status === "in_progress") {
      scheduleScanStatusPolling(game);
    } else if (status === "completed") {
      clearScanStatusPolling();
    }
  }

  async function maybeAutoRequestScan(game, knownDepotIds) {
    if (!game || !game.appid) return;
    if (!getScanEndpoint()) return;

    var appid = String(game.appid);
    var hasDepots = Array.isArray(knownDepotIds) && knownDepotIds.length > 0;
    var hasPatches = Array.isArray(state.currentPatches) && state.currentPatches.length > 0;
    var hasManifests = Array.isArray(state.currentAllManifests) && state.currentAllManifests.length > 0;
    var needsScan = !hasDepots || !hasPatches || !hasManifests;
    if (!needsScan) return;

    if (scanInFlightByAppId[appid]) return;
    if (getScanLock(appid, "auto")) return;
    if (
      state.scanDispatch &&
      String(state.scanDispatch.appid || "") === appid &&
      state.scanDispatch.auto &&
      state.scanDispatch.status !== "idle"
    ) {
      return;
    }
    if (state.scanDispatch && String(state.scanDispatch.appid) === appid && state.scanDispatch.status === "loading") return;

    var result = await requestRemoteScan(game, { auto: true, silent: true });
    if (!result.ok) {
      setScanLock(appid, "auto", { next_allowed_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(), status: "error" }, 30 * 60 * 1000);
    }
    await applyScanDispatchResult(game, result, { auto: true });
  }

  async function maybeAutoRefreshFromSteam(game) {
    if (!game || !game.appid || !App.api || !App.api.refreshNewsFromSteam || !App.api.refreshGameFromSteam) return;

    var appid = String(game.appid);
    var needsRefresh = !state.currentPatches.length || !state.currentAllManifests.length;
    if (!needsRefresh) return;

    var refreshLockKey = getAutoSteamRefreshKey(appid);
    if (getStorageLock(refreshLockKey)) return;

    setStorageLock(refreshLockKey, { triggered_at: new Date().toISOString() }, AUTO_STEAM_REFRESH_COOLDOWN_MS);

    try {
      await App.api.refreshGameFromSteam(appid);
      await App.api.refreshNewsFromSteam(appid);
      state.currentPatches = await App.api.getPatchesByAppId(appid);
      state.currentAllManifests = await App.api.getManifestsByAppId(appid);

      if (state.route.name === "game" && state.currentGame && String(state.currentGame.appid) === appid) {
        await renderGame(state.route);
      }
    } catch (error) {
      // silent: static data remains available
    }
  }

  async function maybeAutoRunGitHubSearch(game, knownDepotIds) {
    if (!game || !game.appid || !App.githubManifestSearch) return;
    if (!Array.isArray(knownDepotIds) || !knownDepotIds.length) return;
    if (state.githubManifestSearch.status !== "idle") return;

    var appid = String(game.appid);
    var autoSearchKey = getAutoGitHubSearchKey(appid);
    if (getStorageLock(autoSearchKey)) return;

    setStorageLock(autoSearchKey, { triggered_at: new Date().toISOString() }, AUTO_GITHUB_SEARCH_COOLDOWN_MS);
    await runGitHubManifestSearch(false, false);
  }

  async function runGitHubManifestSearch(ignoreCache, forceRemote) {
    if (!state.currentGame || !App.githubManifestSearch) return;

    var controller = new AbortController();
    setGitHubSearchState({
      status: "loading",
      message: "Connexion à GitHub…",
      results: ignoreCache ? [] : state.githubManifestSearch.results,
      partial: false,
      sourcesChecked: 0,
      sourceSummaries: [],
      fromCache: false,
      missingDepots: false,
      controller: controller
    });
    await renderGame(state.route);

    try {
      var payload = await App.githubManifestSearch.searchGitHubManifestsForGame(state.currentGame, {
        ignoreCache: Boolean(ignoreCache),
        forceRemote: Boolean(forceRemote),
        signal: controller.signal,
        onProgress: function onProgress(progress) {
          setGitHubSearchState({
            status: "loading",
            message: progress.message || "Recherche dans les sources communautaires…",
            results: progress.results || state.githubManifestSearch.results,
            partial: Boolean(progress.partial),
            sourcesChecked: progress.sources_checked || state.githubManifestSearch.sourcesChecked
          });
          renderGame(state.route);
        },
        onSourceComplete: function onSourceComplete(progress) {
          setGitHubSearchState({
            status: "loading",
            message: "Filtrage des DepotID…",
            results: progress.results || [],
            partial: Boolean(progress.partial),
            sourcesChecked: progress.sources_checked || 0,
            sourceSummaries: progress.source_summaries || []
          });
          renderGame(state.route);
        }
      });

      var nextStatus = "success";
      if (payload.missing_depots || !payload.results.length) nextStatus = "empty";
      if (payload.partial && payload.results.length) nextStatus = "partial";

      setGitHubSearchState({
        status: nextStatus,
        message: "",
        results: payload.results || [],
        partial: Boolean(payload.partial),
        sourcesChecked: payload.sources_checked || 0,
        sourceSummaries: payload.source_summaries || [],
        fromCache: Boolean(payload.from_cache),
        missingDepots: Boolean(payload.missing_depots),
        controller: null
      });

      if (forceRemote) {
        var persistResult = await persistCommunityManifestResults(state.currentGame, payload);
        if (persistResult.ok && persistResult.committed) {
          showToast("Index GitHub mis à jour (+" + String(persistResult.added || 0) + " manifests).", "success");
        } else if (persistResult.ok && persistResult.status === "no_changes") {
          showToast("Aucun nouveau manifest à pousser sur GitHub.", "info");
        } else if (!persistResult.ok) {
          showToast("Recherche OK, mais push GitHub impossible pour le moment.", "warning");
        }
      }

      await renderGame(state.route);
    } catch (error) {
      if (error && error.name === "AbortError") {
        setGitHubSearchState({
          status: "idle",
          message: "Recherche GitHub annulée.",
          controller: null
        });
      } else {
        setGitHubSearchState({
          status: "error",
          message: "Recherche GitHub impossible pour le moment. Réessaie plus tard.",
          controller: null
        });
      }
      await renderGame(state.route);
    }
  }

  async function onClick(event) {
    var button = event.target.closest("[data-action]");
    if (!button) return;

    var action = button.getAttribute("data-action");

    if (action === "go-home") {
      App.router.navigate("/");
      return;
    }

    if (action === "go-tutorial") {
      App.router.navigate("/tutorial");
      return;
    }

    if (action === "go-non-steam-tutorial") {
      App.router.navigate("/tutorial/non-steam");
      return;
    }

    if (action === "go-about") {
      App.router.navigate("/about");
      return;
    }

    if (action === "open-game") {
      var slug = button.getAttribute("data-slug");
      if (!slug) return;
      App.storage.addRecentSearch(state.searchQuery);
      App.router.navigate("/game/" + slug);
      return;
    }

    if (action === "set-quick-tag") {
      var tag = button.getAttribute("data-tag") || "";
      state.activeQuickTag = tag === state.activeQuickTag ? "" : tag;
      App.storage.setPreference("quickTag", state.activeQuickTag);
      renderHome();
      return;
    }

    if (action === "clear-quick-tag") {
      state.activeQuickTag = "";
      App.storage.setPreference("quickTag", "");
      renderHome();
      return;
    }

    if (action === "reuse-search") {
      state.searchQuery = button.getAttribute("data-query") || "";
      refreshHomeSearch();
      return;
    }

    if (action === "select-patch") {
      var patchId = button.getAttribute("data-patch-id") || "";
      state.selectedPatchId = patchId;
      state.patchContentExpanded = false;
      state.mobileDrawerOpen = true;
      await renderGame(state.route);
      return;
    }

    if (action === "toggle-patch-content") {
      state.patchContentExpanded = !state.patchContentExpanded;
      await renderGame(state.route);
      return;
    }

    if (action === "toggle-drawer") {
      state.mobileDrawerOpen = !state.mobileDrawerOpen;
      await renderGame(state.route);
      return;
    }

    if (action === "propose-manifest" || action === "report-manifest") {
      var url = button.getAttribute("data-url");
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      return;
    }

    if (action === "request-scan") {
      if (!state.currentGame) return;
      var fallbackIssueUrl = button.getAttribute("data-url");
      var scanResult = await requestRemoteScan(state.currentGame, { auto: false, silent: false });
      await applyScanDispatchResult(state.currentGame, scanResult, { auto: false });

      if (scanResult.ok) {
        if (scanResult.status === "queued" || scanResult.status === "already-running") {
          showToast(scanResult.message || "Demande de scan envoyée.", "success");
        } else {
          showToast(scanResult.message || "Scan temporairement limité.", "warning");
        }
      } else if (scanResult.reason === "missing_endpoint") {
        showToast("Scan live non configuré ici. Ouverture d'une issue GitHub.", "warning");
        if (fallbackIssueUrl) {
          window.open(fallbackIssueUrl, "_blank", "noopener,noreferrer");
        }
      } else {
        showToast(scanResult.message || "Demande de scan impossible.", "warning");
      }
      return;
    }

    if (action === "github-search-manifests") {
      await runGitHubManifestSearch(button.getAttribute("data-ignore-cache") === "true", true);
      return;
    }

    if (action === "github-cancel-search") {
      if (state.githubManifestSearch.controller) {
        state.githubManifestSearch.controller.abort();
      }
      return;
    }

    if (action === "copy-appid") {
      var appid = button.getAttribute("data-appid");
      var appCopy = await App.steamCommands.copyText(String(appid));
      if (appCopy.ok) {
        pulseButton(button, "AppID copié", "Copier AppID");
        showToast("AppID copié.", "success");
      } else {
        showToast("Copie bloquée par le navigateur. Copie manuelle recommandée.", "warning");
      }
      return;
    }

    if (action === "copy-command") {
      var command = button.getAttribute("data-command") || "";
      var copyResult = await App.steamCommands.copyText(command);
      if (copyResult.ok) {
        pulseButton(button, "Commande copiée", "Copier la commande");
        showToast("Commande copiée.", "success");
      } else {
        showToast("Le presse-papiers est bloqué: copie manuelle disponible.", "warning");
        var box = findParentByClass(button, "command-box");
        if (box) {
          var fallback = box.querySelector(".command-fallback");
          if (fallback) fallback.hidden = false;
        }
      }
      return;
    }

    if (action === "copy-open-console") {
      var steamCommand = button.getAttribute("data-command") || "";
      var result = await App.steamCommands.copyAndOpenSteamConsole(steamCommand);

      var container = findParentByClass(button, "command-box");
      if (container) {
        var help = container.querySelector(".console-help");
        if (help) help.hidden = false;

        if (!result.copied) {
          var fallbackBox = container.querySelector(".command-fallback");
          if (fallbackBox) fallbackBox.hidden = false;
        }
      }

      if (result.copied) {
        pulseButton(button, "Commande copiée", "Copier + ouvrir Steam Console");
        showToast("Commande copiée. Colle-la avec Ctrl+V dans Steam Console.", "success");
      } else {
        showToast("Copie automatique bloquée. Utilise la copie manuelle ci-dessous.", "warning");
      }

      if (!result.opened) {
        showToast("Impossible d'ouvrir steam://open/console automatiquement.", "warning");
      }
      return;
    }
  }

  function onInput(event) {
    var target = event.target;

    if (target.id === "home-search") {
      var cursor = target.selectionStart || target.value.length;
      state.searchQuery = target.value;
      refreshHomeSearch(cursor);
      return;
    }

    var filterKey = target.getAttribute("data-filter");
    if (filterKey && state.route.name === "game") {
      if (target.type === "checkbox") {
        state.gameFilters[filterKey] = Boolean(target.checked);
      } else {
        state.gameFilters[filterKey] = target.value;
      }
      renderGame(state.route);
    }
  }

  function onKeyDown(event) {
    if (event.key === "Enter" && event.target && event.target.id === "home-search") {
      App.storage.addRecentSearch(event.target.value);
    }
  }

  async function bootstrap() {
    if (!root) return;

    var preferences = App.storage.getPreferences();
    state.activeQuickTag = preferences.quickTag || "";

    root.addEventListener("click", onClick);
    root.addEventListener("input", onInput);
    root.addEventListener("change", onInput);
    root.addEventListener("keydown", onKeyDown);

    await App.api.getAllGames();
    App.router.start(renderRoute);
  }

  bootstrap();
})(window);
