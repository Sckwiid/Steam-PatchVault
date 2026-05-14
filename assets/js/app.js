(function initApplication(global) {
  "use strict";

  var App = global.SteamPatchArchive = global.SteamPatchArchive || {};

  var state = {
    route: { name: "home", path: "/", params: {} },
    allGames: [],
    searchQuery: "",
    activeQuickTag: "",
    gameFilters: {
      version: "",
      date: "",
      keyword: "",
      type: "all"
    },
    currentGameSlug: "",
    currentGame: null,
    currentPatches: [],
    selectedPatchId: "",
    manifestsByPatchId: {},
    currentManifests: [],
    mobileDrawerOpen: false
  };

  var root = document.getElementById("app");
  var toastContainer = document.getElementById("toast-container");
  var guideAssets = {
    nonSteamMenu: "https://tse1.mm.bing.net/th/id/OIP.ObomnzvG8JYNOg3bTRbKyQHaDd?pid=Api",
    nonSteamDialog: "https://cdn.mos.cms.futurecdn.net/JesibHpNgqiFpDEjcU3GNA-1200-80.jpg"
  };

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

  function ConfidenceBadge(score) {
    var numeric = Number(score || 0);
    var level = "low";
    if (numeric >= 85) level = "high";
    else if (numeric >= 60) level = "mid";

    return '<span class="confidence confidence-' + level + '">Confiance ' + escapeHtml(numeric) + "/100</span>";
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
    var command = App.steamCommands.buildDownloadCommand(appid, manifest.depotid, manifest.manifestid);
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
      '<p class="detail-content">' + escapeHtml(patch.content) + "</p>" +
      '<p class="muted">Source: <a href="' + escapeHtml(patch.source_url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(patch.source_url) + "</a></p>" +
      '<section class="manifest-section">' +
      '<h4>Versions téléchargeables</h4>' +
      (manifests.length ? manifests.map(function mapManifest(manifest) {
        return "" +
          '<div class="manifest-card">' +
          '<div class="manifest-head">' +
          ConfidenceBadge(manifest.confidence_score) +
          '<span class="mono">' + escapeHtml((manifest.branch || "public") + " · " + (manifest.os || "all") + " · " + (manifest.language || "all")) + "</span>" +
          "</div>" +
          '<p class="muted">' + escapeHtml(manifest.notes || "") + "</p>" +
          CommandBox(game.appid, manifest) +
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
    var filteredByTag = state.activeQuickTag ? App.search.filterGamesByQuickTag(allGames, state.activeQuickTag) : allGames;

    var results = [];
    if (state.searchQuery) {
      results = App.search.searchGames(filteredByTag, state.searchQuery, { limit: 12, minScore: 26 }).map(function map(entry) {
        return entry.game;
      });
    } else {
      results = filteredByTag.slice(0, 9);
    }

    var recentGames = storage.getRecentGames(6);
    var recentSearches = storage.getRecentSearches(6);

    var quickTagsHtml = App.search.QUICK_TAGS.map(function mapTag(tag) {
      var active = tag === state.activeQuickTag;
      return '<button class="tag-chip ' + (active ? "is-active" : "") + '" data-action="set-quick-tag" data-tag="' + escapeHtml(tag) + '">' + escapeHtml(tag) + "</button>";
    }).join("");

    var resultsHtml = results.length
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
      '<h2>Résultats</h2>' +
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

      return okVersion && okDate && okType && okKeyword;
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
      state.currentGameSlug = slug;
      state.currentGame = null;
      state.currentPatches = [];
      state.selectedPatchId = "";
      state.manifestsByPatchId = {};
      state.currentManifests = [];
      state.mobileDrawerOpen = false;
      state.gameFilters = {
        version: "",
        date: "",
        keyword: "",
        type: "all"
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

    App.storage.addRecentGame(game);

    var filteredPatches = applyPatchFilters(state.currentPatches);

    if (!state.selectedPatchId && filteredPatches.length) {
      state.selectedPatchId = filteredPatches[0].id;
    }

    var selectedPatch = filteredPatches.find(function findPatch(item) {
      return item.id === state.selectedPatchId;
    }) || filteredPatches[0] || null;

    state.selectedPatchId = selectedPatch ? selectedPatch.id : "";
    state.currentManifests = selectedPatch ? await ensureManifestsForPatch(selectedPatch.id, game.appid) : [];

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
      '<div class="hero-actions">' +
      '<button class="btn btn-subtle" data-action="copy-appid" data-appid="' + escapeHtml(game.appid) + '">Copier AppID</button>' +
      '<button class="btn btn-subtle" data-action="go-tutorial">Voir le tutoriel</button>' +
      "</div>" +
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
      "</section>" +
      '<section class="game-layout">' +
      '<div class="timeline-col">' +
      '<h2>Timeline des patch notes</h2>' +
      PatchTimeline(filteredPatches, state.selectedPatchId) +
      "</div>" +
      '<div class="detail-col ' + (state.mobileDrawerOpen ? "is-open" : "") + '">' +
      '<button class="drawer-toggle" data-action="toggle-drawer" aria-expanded="' + (state.mobileDrawerOpen ? "true" : "false") + '">' + (state.mobileDrawerOpen ? "Fermer détail patch" : "Ouvrir détail patch") + "</button>" +
      PatchDetailPanel(game, selectedPatch, state.currentManifests) +
      "</div>" +
      "</section>";

    root.innerHTML = layout(content);
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

    if (!state.allGames.length) {
      state.allGames = await App.api.getAllGames();
    }

    if (route.name === "home") {
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
      renderHome();
      return;
    }

    if (action === "select-patch") {
      var patchId = button.getAttribute("data-patch-id") || "";
      state.selectedPatchId = patchId;
      state.mobileDrawerOpen = true;
      await renderGame(state.route);
      return;
    }

    if (action === "toggle-drawer") {
      state.mobileDrawerOpen = !state.mobileDrawerOpen;
      await renderGame(state.route);
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
      renderHome();
      var refreshedInput = root.querySelector("#home-search");
      if (refreshedInput) {
        refreshedInput.focus();
        refreshedInput.setSelectionRange(cursor, cursor);
      }
      return;
    }

    var filterKey = target.getAttribute("data-filter");
    if (filterKey && state.route.name === "game") {
      state.gameFilters[filterKey] = target.value;
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
