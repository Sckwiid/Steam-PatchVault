#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(repoRoot, "data");
const gamesDir = path.join(dataRoot, "games");
const patchesDir = path.join(dataRoot, "patches");
const manifestsDir = path.join(dataRoot, "manifests");
const manualRoot = path.join(dataRoot, "manual");
const manualPatchesDir = path.join(manualRoot, "patches");
const manualManifestsDir = path.join(manualRoot, "manifests");
const manifestSnapshotsDir = path.join(dataRoot, "manifest-snapshots");
const contributionsDir = path.join(dataRoot, "contributions");
const pendingManifestsFile = path.join(contributionsDir, "pending-manifests.json");
const depotToAppIndexFile = path.join(dataRoot, "depot-to-app-index.json");
const searchIndexFile = path.join(dataRoot, "search-index.json");
const trackedAppsFile = path.join(dataRoot, "tracked-apps.json");

const DEFAULTS = {
  maxApps: 50000,
  newsCount: 12,
  newsMaxLength: 2200,
  includeFeeds: "steam_community_announcements",
  sourceMode: "steam"
};

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envString(name, fallback) {
  const raw = process.env[name];
  return raw && String(raw).trim() ? String(raw).trim() : fallback;
}

const config = {
  steamApiKey: envString("STEAM_WEB_API_KEY", ""),
  maxApps: envNumber("PATCHVAULT_MAX_APPS", DEFAULTS.maxApps),
  newsCount: envNumber("PATCHVAULT_NEWS_COUNT", DEFAULTS.newsCount),
  newsMaxLength: envNumber("PATCHVAULT_NEWS_MAXLENGTH", DEFAULTS.newsMaxLength),
  includeFeeds: envString("PATCHVAULT_NEWS_FEEDS", DEFAULTS.includeFeeds),
  sourceMode: envString("PATCHVAULT_SOURCE", DEFAULTS.sourceMode).toLowerCase(),
  extraPatchAppIds: envString("PATCHVAULT_PATCH_APPIDS", "")
};

function info(message) {
  process.stdout.write(`[build-static-db] ${message}\n`);
}

function warn(message) {
  process.stderr.write(`[build-static-db] WARN: ${message}\n`);
}

async function readJson(filePath, fallbackValue) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    return fallbackValue;
  }
}

async function writeJson(filePath, value) {
  const next = `${JSON.stringify(value, null, 2)}\n`;
  let previous = null;

  try {
    previous = await fs.readFile(filePath, "utf8");
  } catch (error) {
    // File does not exist yet.
  }

  if (previous === next) {
    return false;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, next, "utf8");
  return true;
}

async function listNumericJsonFiles(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /^\d+\.json$/.test(entry.name))
      .map((entry) => ({
        appid: Number(entry.name.replace(".json", "")),
        filePath: path.join(dirPath, entry.name)
      }))
      .filter((entry) => Number.isFinite(entry.appid) && entry.appid > 0);
  } catch (error) {
    return [];
  }
}

async function emptyDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  await Promise.all(
    entries.map((entry) => fs.rm(path.join(dirPath, entry.name), { recursive: true, force: true }))
  );
}

function slugify(input) {
  const normalized = String(input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "steam-app";
}

function bucketFromName(name) {
  const first = String(name || "").trim().charAt(0).toLowerCase();
  return /[a-z]/.test(first) ? first : "0-9";
}

function detectPatchType(text) {
  const value = String(text || "").toLowerCase();
  if (/hotfix|fix|crash|bug/.test(value)) return "hotfix";
  if (/balance|nerf|buff|equilibr|équilibr/.test(value)) return "balance";
  if (/content|chapter|episode|biome|dlc|event|quest|new/.test(value)) return "content";
  if (/update|major|overhaul|expansion|release/.test(value)) return "major";
  return "minor";
}

function detectVersion(text) {
  const match = String(text || "").match(/\b\d+\.\d+(?:\.\d+)?(?:[a-z0-9-]+)?\b/i);
  return match ? match[0] : "";
}

function stripHtml(raw) {
  return String(raw || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractKeywords(title, content) {
  const source = `${title || ""} ${content || ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const terms = [
    "performance",
    "stability",
    "bug",
    "fix",
    "balance",
    "content",
    "network",
    "multiplayer",
    "mod",
    "ui",
    "quest",
    "event",
    "crash"
  ];

  return terms.filter((term) => source.includes(term)).slice(0, 6);
}

async function fetchJson(url, { timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "user-agent": "Steam PatchVault Static DB Builder" } });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeAppEntries(rawApps) {
  const map = new Map();

  (rawApps || []).forEach((item) => {
    const appid = Number(item?.appid ?? item?.app_id ?? item?.id);
    const name = String(item?.name ?? item?.app_name ?? "").trim();
    if (!Number.isFinite(appid) || appid <= 0 || !name) return;
    if (!map.has(appid)) {
      map.set(appid, { appid, name });
    }
  });

  return Array.from(map.values());
}

async function fetchFromIStoreService(apiKey, maxApps) {
  if (!apiKey) {
    return [];
  }

  info("Tentative IStoreService/GetAppList/v1...");

  const apps = [];
  let lastAppId = 0;
  let page = 0;

  while (apps.length < maxApps && page < 30) {
    const url = new URL("https://api.steampowered.com/IStoreService/GetAppList/v1/");
    url.searchParams.set("key", apiKey);
    url.searchParams.set("max_results", String(Math.min(50000, maxApps)));
    url.searchParams.set("include_games", "true");
    url.searchParams.set("include_dlc", "false");
    url.searchParams.set("include_software", "false");
    url.searchParams.set("include_videos", "false");
    url.searchParams.set("include_hardware", "false");
    if (lastAppId > 0) {
      url.searchParams.set("last_appid", String(lastAppId));
    }

    const payload = await fetchJson(url.toString());
    const response = payload?.response || {};
    const chunk = normalizeAppEntries(response.apps || response.apps_list || []);

    if (!chunk.length) {
      break;
    }

    apps.push(...chunk);
    page += 1;

    const haveMore = Boolean(response.have_more_results);
    const nextId = Number(response.last_appid || chunk[chunk.length - 1].appid);

    if (!haveMore || !Number.isFinite(nextId) || nextId <= lastAppId) {
      break;
    }

    lastAppId = nextId;
  }

  return normalizeAppEntries(apps).slice(0, maxApps);
}

async function fetchFromISteamApps(maxApps) {
  info("Fallback ISteamApps/GetAppList/v2...");
  const url = "https://api.steampowered.com/ISteamApps/GetAppList/v2/";
  const payload = await fetchJson(url);
  const apps = normalizeAppEntries(payload?.applist?.apps || []);
  return apps.slice(0, maxApps);
}

async function loadSampleDataset() {
  info("Chargement dataset sample local.");
  const games = await readJson(path.join(dataRoot, "games.sample.json"), []);
  const patches = await readJson(path.join(dataRoot, "patches.sample.json"), []);
  const manifests = await readJson(path.join(dataRoot, "manifests.sample.json"), []);

  return {
    catalogSource: "sample",
    games: normalizeAppEntries(games),
    sampleGameDetails: Array.isArray(games) ? games : [],
    samplePatches: Array.isArray(patches) ? patches : [],
    sampleManifests: Array.isArray(manifests) ? manifests : []
  };
}

async function resolveCatalog() {
  if (config.sourceMode === "sample") {
    return loadSampleDataset();
  }

  try {
    const storeApps = await fetchFromIStoreService(config.steamApiKey, config.maxApps);
    if (storeApps.length) {
      return {
        catalogSource: "IStoreService/GetAppList/v1",
        games: storeApps,
        sampleGameDetails: [],
        samplePatches: [],
        sampleManifests: []
      };
    }
  } catch (error) {
    warn(`IStoreService indisponible: ${error.message}`);
  }

  try {
    const apps = await fetchFromISteamApps(config.maxApps);
    if (apps.length) {
      return {
        catalogSource: "ISteamApps/GetAppList/v2",
        games: apps,
        sampleGameDetails: [],
        samplePatches: [],
        sampleManifests: []
      };
    }
  } catch (error) {
    warn(`ISteamApps indisponible: ${error.message}`);
  }

  warn("Aucun endpoint Steam disponible, fallback sur dataset sample.");
  return loadSampleDataset();
}

function mergeGames(catalogGames, trackedMap, sampleDetails, generatedAt) {
  const catalogMap = new Map(catalogGames.map((game) => [String(game.appid), game]));
  for (const [appid, tracked] of trackedMap.entries()) {
    if (!catalogMap.has(appid)) {
      catalogMap.set(appid, {
        appid: Number(appid),
        name: tracked.name || `Steam App ${appid}`
      });
    }
  }

  const sampleMap = new Map(sampleDetails.map((game) => [String(game.appid), game]));
  const usedSlugs = new Set();

  const merged = Array.from(catalogMap.values()).map((game) => {
    const key = String(game.appid);
    const tracked = trackedMap.get(key) || {};
    const sample = sampleMap.get(key) || {};

    const name = tracked.name || sample.name || game.name;
    const baseSlug = tracked.slug || sample.slug || slugify(name);
    let slug = baseSlug;

    if (usedSlugs.has(slug)) {
      slug = `${baseSlug}-${game.appid}`;
    }
    usedSlugs.add(slug);

    const tags = Array.isArray(tracked.tags)
      ? tracked.tags
      : Array.isArray(sample.tags)
        ? sample.tags
        : [];

    return {
      appid: game.appid,
      name,
      slug,
      header_image: tracked.header_image || sample.header_image || `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/header.jpg`,
      description:
        tracked.description ||
        sample.description ||
        "Fiche générée automatiquement depuis la base statique Steam PatchVault.",
      last_synced_at: generatedAt,
      tags,
      depotids: Array.from(new Set([]
        .concat(Array.isArray(tracked.depotids) ? tracked.depotids : [])
        .concat(Array.isArray(tracked.depotIds) ? tracked.depotIds : [])
        .concat(Array.isArray(sample.depotids) ? sample.depotids : [])
        .map((depotid) => String(depotid).replace(/\D/g, ""))
        .filter(Boolean))),
      bucket: bucketFromName(name)
    };
  });

  return merged.sort((a, b) => a.name.localeCompare(b.name, "fr") || a.appid - b.appid);
}

function buildSearchIndex(games, generatedAt, catalogSource) {
  const buckets = {};
  games.forEach((game) => {
    buckets[game.bucket] = game.bucket;
  });

  return {
    generated_at: generatedAt,
    source: "steam-static-db",
    catalog_source: catalogSource,
    total_games: games.length,
    buckets,
    games: games.map((game) => ({
      appid: game.appid,
      name: game.name,
      slug: game.slug,
      header_image: game.header_image,
      description: game.description,
      tags: game.tags,
      depotids: game.depotids || [],
      last_synced_at: game.last_synced_at,
      bucket: game.bucket
    }))
  };
}

function splitGamesByBucket(games, generatedAt) {
  const grouped = new Map();

  games.forEach((game) => {
    const bucket = game.bucket;
    if (!grouped.has(bucket)) grouped.set(bucket, []);
    grouped.get(bucket).push(game);
  });

  return Array.from(grouped.entries()).map(([bucket, bucketGames]) => ({
    bucket,
    fileName: `${bucket}.json`,
    payload: {
      bucket,
      generated_at: generatedAt,
      games: bucketGames
    }
  }));
}

function resolveTrackedAppIds(trackedEntries) {
  const fromFile = trackedEntries
    .map((entry) => Number(entry.appid))
    .filter((appid) => Number.isFinite(appid) && appid > 0);

  const fromEnv = String(config.extraPatchAppIds || "")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((appid) => Number.isFinite(appid) && appid > 0);

  return Array.from(new Set([...fromFile, ...fromEnv]));
}

async function resolveManualAppIds() {
  const patchFiles = await listNumericJsonFiles(manualPatchesDir);
  const manifestFiles = await listNumericJsonFiles(manualManifestsDir);
  return Array.from(new Set([...patchFiles, ...manifestFiles].map((entry) => entry.appid)));
}

async function fetchNewsForApp(appid, useFeeds = true) {
  const url = new URL("https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/");
  url.searchParams.set("appid", String(appid));
  url.searchParams.set("count", String(config.newsCount));
  url.searchParams.set("maxlength", String(config.newsMaxLength));
  url.searchParams.set("enddate", String(Math.floor(Date.now() / 1000)));
  if (useFeeds && config.includeFeeds) {
    url.searchParams.set("feeds", config.includeFeeds);
  }

  const payload = await fetchJson(url.toString());
  const items = payload?.appnews?.newsitems;
  return Array.isArray(items) ? items : [];
}

function normalizePatchItems(appid, newsItems) {
  return newsItems.map((item, index) => {
    const title = String(item?.title || "Mise à jour Steam").trim();
    const plainContent = stripHtml(item?.contents || "");
    const sourceUrl = String(item?.url || `https://store.steampowered.com/news/app/${appid}`);
    const sourceType = /store\.steampowered\.com/.test(sourceUrl)
      ? "steam_news"
      : /steamcommunity\.com/.test(sourceUrl)
        ? "community"
        : "manual";

    const composed = `${title} ${plainContent}`;

    return {
      id: `steam-news-${appid}-${item?.gid || item?.date || index}`,
      appid,
      title,
      version_detected: detectVersion(composed),
      date: item?.date ? new Date(Number(item.date) * 1000).toISOString() : new Date().toISOString(),
      type: detectPatchType(composed),
      content: plainContent,
      source_url: sourceUrl,
      source_type: sourceType,
      keywords: extractKeywords(title, plainContent)
    };
  }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

async function loadManualPatches(appid) {
  const payload = await readJson(path.join(manualPatchesDir, `${appid}.json`), null);
  if (!payload) return [];
  const patches = Array.isArray(payload) ? payload : payload.patches;
  return Array.isArray(patches) ? patches : [];
}

async function loadManualManifests(appid) {
  const payload = await readJson(path.join(manualManifestsDir, `${appid}.json`), null);
  if (!payload) return [];
  const manifests = Array.isArray(payload) ? payload : payload.manifests;
  return Array.isArray(manifests) ? manifests : [];
}

function mergeByKey(baseItems, manualItems, keyFn) {
  const map = new Map();

  (baseItems || []).forEach((item) => {
    const key = keyFn(item);
    if (key) map.set(key, item);
  });

  (manualItems || []).forEach((item) => {
    const key = keyFn(item);
    if (key) map.set(key, item);
  });

  return Array.from(map.values());
}

function patchKey(patch) {
  return String(patch?.id || `${patch?.appid || ""}:${patch?.date || ""}:${patch?.title || ""}`);
}

function manifestKey(manifest) {
  return String(
    manifest?.id ||
      `${manifest?.appid || ""}:${manifest?.depotid || ""}:${manifest?.manifestid || ""}:${manifest?.branch || ""}`
  );
}

function flattenManifestPayload(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.manifests)) return payload.manifests;

  if (!Array.isArray(payload.depots)) return [];

  return payload.depots.flatMap((depot) => {
    const depotid = depot?.depotid;
    const depotName = depot?.name || "";
    const depotOs = depot?.os || "all";
    const depotLanguage = depot?.language || "all";

    return (depot?.manifests || []).map((manifest) => ({
      ...manifest,
      depotid: manifest.depotid || depotid,
      depot_name: manifest.depot_name || depotName,
      os: manifest.os || depotOs,
      language: manifest.language || depotLanguage
    }));
  });
}

function normalizeManifestRecord(appid, manifest, observedAt) {
  const depotid = Number(manifest?.depotid);
  const manifestid = String(manifest?.manifestid || "").trim();
  if (!Number.isFinite(depotid) || !manifestid) return null;

  const source = manifest.source || manifest.source_type || "manual";
  const firstSeen = manifest.first_seen_at || manifest.date || observedAt;
  const lastSeen = manifest.last_seen_at || manifest.date || observedAt;
  const downloadCommand = manifest.download_command || `download_depot ${appid} ${depotid} ${manifestid}`;

  return {
    id: manifest.id || `manifest-${appid}-${depotid}-${manifestid}`,
    appid,
    depotid,
    depot_name: manifest.depot_name || manifest.name || `Depot ${depotid}`,
    manifestid,
    buildid: String(manifest.buildid || "unknown"),
    branch: manifest.branch || "public",
    os: manifest.os || "all",
    language: manifest.language || "all",
    date: manifest.date || firstSeen,
    first_seen_at: firstSeen,
    last_seen_at: lastSeen,
    patch_note_id: manifest.patch_note_id || "",
    confidence_score: Number.isFinite(Number(manifest.confidence_score)) ? Number(manifest.confidence_score) : 40,
    source,
    status: manifest.status || "unverified",
    download_command: downloadCommand,
    notes: manifest.notes || "Manifest connu, téléchargement non garanti."
  };
}

function associateManifestToPatch(manifest, patches) {
  if (manifest.patch_note_id || !Array.isArray(patches) || !patches.length) {
    return manifest;
  }

  const manifestDate = new Date(manifest.date || manifest.first_seen_at || 0).getTime();
  if (!Number.isFinite(manifestDate)) return manifest;

  let bestPatch = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  patches.forEach((patch) => {
    const patchDate = new Date(patch.date || 0).getTime();
    if (!Number.isFinite(patchDate)) return;
    const distance = Math.abs(manifestDate - patchDate);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPatch = patch;
    }
  });

  if (!bestPatch) return manifest;

  const days = bestDistance / 86400000;
  if (days > 14) return manifest;

  const temporalScore = Math.max(35, Math.round(90 - days * 8));
  return {
    ...manifest,
    patch_note_id: bestPatch.id,
    confidence_score: Math.max(Number(manifest.confidence_score || 0), temporalScore),
    notes: `${manifest.notes || "Manifest connu."} Association patch note estimée par proximité temporelle.`
  };
}

function buildDepotHistory(appid, existingPayload, incomingManifests, patches, observedAt) {
  const existing = flattenManifestPayload(existingPayload)
    .map((manifest) => normalizeManifestRecord(appid, manifest, observedAt))
    .filter(Boolean);

  const incoming = flattenManifestPayload(incomingManifests)
    .map((manifest) => normalizeManifestRecord(appid, manifest, observedAt))
    .filter(Boolean)
    .map((manifest) => associateManifestToPatch(manifest, patches));

  const history = new Map();

  existing.forEach((manifest) => {
    history.set(manifestKey(manifest), manifest);
  });

  incoming.forEach((manifest) => {
    const key = manifestKey(manifest);
    const previous = history.get(key);

    if (previous) {
      history.set(key, {
        ...previous,
        ...manifest,
        first_seen_at: previous.first_seen_at || manifest.first_seen_at,
        last_seen_at: observedAt,
        confidence_score: Math.max(Number(previous.confidence_score || 0), Number(manifest.confidence_score || 0))
      });
      return;
    }

    history.set(key, {
      ...manifest,
      first_seen_at: manifest.first_seen_at || observedAt,
      last_seen_at: observedAt
    });
  });

  const depotsMap = new Map();

  Array.from(history.values())
    .sort((a, b) => new Date(b.first_seen_at || b.date || 0).getTime() - new Date(a.first_seen_at || a.date || 0).getTime())
    .forEach((manifest) => {
      const depotKey = String(manifest.depotid);
      if (!depotsMap.has(depotKey)) {
        depotsMap.set(depotKey, {
          depotid: manifest.depotid,
          name: manifest.depot_name || `Depot ${manifest.depotid}`,
          os: manifest.os || "all",
          language: manifest.language || "all",
          manifests: []
        });
      }
      depotsMap.get(depotKey).manifests.push({
        manifestid: manifest.manifestid,
        buildid: manifest.buildid,
        branch: manifest.branch,
        first_seen_at: manifest.first_seen_at,
        last_seen_at: manifest.last_seen_at,
        patch_note_id: manifest.patch_note_id,
        confidence_score: manifest.confidence_score,
        source: manifest.source,
        status: manifest.status,
        download_command: manifest.download_command,
        notes: manifest.notes
      });
    });

  return Array.from(depotsMap.values()).sort((a, b) => a.depotid - b.depotid);
}

async function writeManifestSnapshot(appid, observedAt, depots) {
  const day = observedAt.slice(0, 10);
  await writeJson(path.join(manifestSnapshotsDir, String(appid), `${day}.json`), {
    appid,
    scanned_at: observedAt,
    source: "steam_appinfo_snapshot",
    depots
  });
}

async function buildPatchAndManifestFiles({ trackedEntries, samplePatches, sampleManifests, generatedAt }) {
  const manualIds = await resolveManualAppIds();
  const trackedIds = Array.from(new Set([...resolveTrackedAppIds(trackedEntries), ...manualIds]));
  const trackedByApp = new Map(trackedEntries.map((entry) => [String(entry.appid), entry]));
  const depotIndex = {
    updated_at: generatedAt,
    by_appid: {},
    depots: []
  };
  const samplePatchesByApp = new Map();
  const sampleManifestsByApp = new Map();

  samplePatches.forEach((patch) => {
    const key = String(patch.appid);
    if (!samplePatchesByApp.has(key)) samplePatchesByApp.set(key, []);
    samplePatchesByApp.get(key).push(patch);
  });

  sampleManifests.forEach((manifest) => {
    const key = String(manifest.appid);
    if (!sampleManifestsByApp.has(key)) sampleManifestsByApp.set(key, []);
    sampleManifestsByApp.get(key).push(manifest);
  });

  for (const appid of trackedIds) {
    const appKey = String(appid);
    let patches = [];
    const manualPatches = await loadManualPatches(appid);
    const manualManifests = await loadManualManifests(appid);
    const existingPatchFile = await readJson(path.join(patchesDir, `${appid}.json`), { patches: [] });
    const existingManifestFile = await readJson(path.join(manifestsDir, `${appid}.json`), { manifests: [] });

    try {
      let news = await fetchNewsForApp(appid, true);
      if (!news.length && config.includeFeeds) {
        news = await fetchNewsForApp(appid, false);
      }
      patches = normalizePatchItems(appid, news);
      info(`Patch notes récupérées pour appid=${appid}: ${patches.length}`);
    } catch (error) {
      warn(`ISteamNews indisponible pour appid=${appid}: ${error.message}`);
    }

    if (!patches.length) {
      patches = Array.isArray(existingPatchFile.patches) ? existingPatchFile.patches : [];
    }

    if (!patches.length) {
      patches = samplePatchesByApp.get(appKey) || [];
    }

    patches = mergeByKey(patches, manualPatches, patchKey)
      .map((patch) => ({ ...patch, appid }))
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

    let manifests = Array.isArray(existingManifestFile.manifests) ? existingManifestFile.manifests : [];
    if (!manifests.length && Array.isArray(existingManifestFile.depots)) {
      manifests = flattenManifestPayload(existingManifestFile);
    }
    if (!manifests.length) {
      manifests = sampleManifestsByApp.get(appKey) || [];
    }
    manifests = mergeByKey(manifests, manualManifests, manifestKey).map((manifest) => ({ ...manifest, appid }));
    const depots = buildDepotHistory(appid, existingManifestFile, manifests, patches, generatedAt);
    const trackedSince = existingManifestFile.tracked_since || generatedAt;
    const tracked = trackedByApp.get(appKey) || {};
    const trackedDepotIds = []
      .concat(Array.isArray(tracked.depotids) ? tracked.depotids : [])
      .concat(Array.isArray(tracked.depotIds) ? tracked.depotIds : [])
      .map((depotid) => String(depotid).replace(/\D/g, ""))
      .filter(Boolean);

    await writeManifestSnapshot(appid, generatedAt, depots);

    const knownDepotIds = Array.from(new Set(
      depots.map((depot) => String(depot.depotid)).concat(trackedDepotIds)
    ));
    depotIndex.by_appid[appKey] = knownDepotIds;
    knownDepotIds.forEach((depotid) => {
      depotIndex.depots.push({
        appid,
        depotid
      });
    });

    await writeJson(path.join(patchesDir, `${appid}.json`), {
      appid,
      generated_at: generatedAt,
      source: "steam-static-db",
      patches
    });

    await writeJson(path.join(manifestsDir, `${appid}.json`), {
      appid,
      last_scanned_at: generatedAt,
      tracked_since: trackedSince,
      depots,
      notes:
        depots.length === 0
          ? "Aucun mapping manifest fiable disponible publiquement pour cet AppID."
          : "Mappings issus de sources automatiques et/ou manuelles. Vérifier la validité avant usage."
    });
  }

  depotIndex.depots.sort((a, b) => Number(a.appid) - Number(b.appid) || Number(a.depotid) - Number(b.depotid));
  await writeJson(depotToAppIndexFile, depotIndex);
}

async function main() {
  const generatedAt = new Date().toISOString();

  const trackedConfig = await readJson(trackedAppsFile, { apps: [] });
  const trackedEntries = Array.isArray(trackedConfig.apps) ? trackedConfig.apps : [];
  const trackedMap = new Map(trackedEntries.map((entry) => [String(entry.appid), entry]));

  const catalog = await resolveCatalog();

  const games = mergeGames(catalog.games, trackedMap, catalog.sampleGameDetails || [], generatedAt);
  const searchIndex = buildSearchIndex(games, generatedAt, catalog.catalogSource);
  const buckets = splitGamesByBucket(games, generatedAt);

  await fs.mkdir(dataRoot, { recursive: true });
  await emptyDir(gamesDir);
  await fs.mkdir(patchesDir, { recursive: true });
  await fs.mkdir(manifestsDir, { recursive: true });
  await fs.mkdir(manifestSnapshotsDir, { recursive: true });
  await fs.mkdir(contributionsDir, { recursive: true });
  const pendingManifests = await readJson(pendingManifestsFile, null);
  if (!pendingManifests) {
    await writeJson(pendingManifestsFile, {
      updated_at: generatedAt,
      manifests: []
    });
  }

  await writeJson(searchIndexFile, searchIndex);

  for (const bucket of buckets) {
    await writeJson(path.join(gamesDir, bucket.fileName), bucket.payload);
  }

  await buildPatchAndManifestFiles({
    trackedEntries,
    samplePatches: catalog.samplePatches || [],
    sampleManifests: catalog.sampleManifests || [],
    generatedAt
  });

  info(`Index généré: ${games.length} jeux, ${buckets.length} buckets.`);
  info("Database statique prête (runtime API-free). ");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
