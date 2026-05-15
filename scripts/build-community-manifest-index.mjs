#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const outputFile = path.join(repoRoot, "data", "community-manifest-index.json");

const GITHUB_MANIFEST_SOURCES = [
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

function info(message) {
  process.stdout.write(`[build-community-manifest-index] ${message}\n`);
}

function warn(message) {
  process.stderr.write(`[build-community-manifest-index] WARN: ${message}\n`);
}

async function readJson(filePath, fallbackValue) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
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

  if (previous === next) return false;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, next, "utf8");
  return true;
}

async function fetchJson(url) {
  const headers = {
    "accept": "application/vnd.github+json",
    "user-agent": "Steam PatchVault Community Manifest Index Builder"
  };

  if (process.env.GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

function parseManifestFilename(filePath, sourceRepo) {
  const filename = String(filePath || "").split("/").pop();
  const match = /^(\d+)_(\d+)\.manifest$/.exec(filename);
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

function pushByDepot(index, item) {
  if (!index.by_depotid[item.depotid]) index.by_depotid[item.depotid] = [];
  const key = `${item.depotid}:${item.manifestid}`;
  if (index.seen[key]) return;
  index.seen[key] = true;
  index.by_depotid[item.depotid].push(item);
}

async function fetchSource(source) {
  const url = `https://api.github.com/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/git/trees/${encodeURIComponent(source.branch)}?recursive=1`;
  const payload = await fetchJson(url);
  const manifests = [];

  for (const entry of payload.tree || []) {
    if (!entry || entry.type !== "blob") continue;
    const parsed = parseManifestFilename(entry.path, source.label);
    if (parsed) manifests.push(parsed);
  }

  return {
    source: source.label,
    truncated: Boolean(payload.truncated),
    manifests
  };
}

async function main() {
  const generatedAt = new Date().toISOString();
  const existing = await readJson(outputFile, null);
  const index = {
    generated_at: generatedAt,
    source: "github_tree_index",
    partial: false,
    sources: [],
    by_depotid: {},
    seen: Object.create(null)
  };

  if (existing && existing.by_depotid) {
    Object.entries(existing.by_depotid).forEach(([depotid, manifests]) => {
      (manifests || []).forEach((manifest) => pushByDepot(index, { ...manifest, depotid: String(depotid) }));
    });
  }

  for (const source of GITHUB_MANIFEST_SOURCES) {
    try {
      info(`Lecture ${source.label}...`);
      const result = await fetchSource(source);
      result.manifests.forEach((manifest) => pushByDepot(index, manifest));
      index.partial = index.partial || result.truncated;
      index.sources.push({
        source: result.source,
        truncated: result.truncated,
        manifests_found: result.manifests.length
      });
    } catch (error) {
      warn(`${source.label}: ${error.message}`);
      index.partial = true;
      index.sources.push({
        source: source.label,
        truncated: false,
        manifests_found: 0,
        error: error.message
      });
    }
  }

  delete index.seen;
  index.total_depots = Object.keys(index.by_depotid).length;
  index.total_manifests = Object.values(index.by_depotid).reduce((sum, manifests) => sum + manifests.length, 0);

  await writeJson(outputFile, index);
  info(`Index prêt: ${index.total_manifests} manifests, ${index.total_depots} depots.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
