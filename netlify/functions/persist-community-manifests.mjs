const INDEX_PATH = "data/community-manifest-index.json";
const DEFAULT_BRANCH = "main";
const DEFAULT_COOLDOWN_MINUTES = 15;
const MAX_RESULTS_PER_REQUEST = 500;
const BURST_WINDOW_MS = 20 * 1000;

const burstMap = new Map();

function buildCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": process.env.SCAN_CORS_ORIGIN || "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...buildCorsHeaders()
    },
    body: JSON.stringify(payload)
  };
}

function isOriginAllowed(originValue) {
  const configured = String(process.env.SCAN_ALLOWED_ORIGINS || "").trim();
  if (!configured) return true;
  const allowed = configured.split(",").map((value) => value.trim()).filter(Boolean);
  if (!allowed.length) return true;
  return allowed.includes(String(originValue || "").trim());
}

function resolveRepoConfig() {
  const explicitOwner = String(process.env.GITHUB_OWNER || "").trim();
  const explicitRepo = String(process.env.GITHUB_REPO || "").trim();
  const fallbackRepository = String(process.env.GITHUB_REPOSITORY || "").trim();
  const token = String(process.env.GITHUB_PAT || process.env.GITHUB_TOKEN || "").trim();
  const branch = String(process.env.GITHUB_SCAN_REF || DEFAULT_BRANCH).trim();
  const cooldownMinutes = Number(process.env.PERSIST_MANIFEST_COOLDOWN_MINUTES || DEFAULT_COOLDOWN_MINUTES);

  let owner = explicitOwner;
  let repo = explicitRepo;
  if ((!owner || !repo) && fallbackRepository.includes("/")) {
    const [fallbackOwner, fallbackRepo] = fallbackRepository.split("/");
    owner = owner || fallbackOwner;
    repo = repo || fallbackRepo;
  }

  return {
    owner,
    repo,
    token,
    branch,
    cooldownMs: Math.max(2 * 60 * 1000, Math.floor(cooldownMinutes * 60 * 1000))
  };
}

function getClientIp(event) {
  return (
    event?.headers?.["x-nf-client-connection-ip"] ||
    event?.headers?.["client-ip"] ||
    event?.headers?.["x-forwarded-for"] ||
    "unknown"
  );
}

function normalizeValue(value) {
  return String(value || "").trim();
}

function normalizeManifestRow(input) {
  const depotid = normalizeValue(input?.depotid);
  const manifestid = normalizeValue(input?.manifestid);
  if (!/^\d+$/.test(depotid) || !/^\d+$/.test(manifestid)) return null;

  const appid = normalizeValue(input?.appid);
  const sourceRepo = normalizeValue(input?.source_repo) || "unknown";

  const row = {
    depotid,
    manifestid,
    source_repo: sourceRepo,
    source_type: normalizeValue(input?.source_type) || "github_tree_index",
    status: normalizeValue(input?.status) || "unverified",
    confidence_score: Number(input?.confidence_score || 25)
  };

  if (/^\d+$/.test(appid)) {
    row.appid = appid;
  }

  return row;
}

function pruneBurstMap() {
  const now = Date.now();
  for (const [key, createdAt] of burstMap.entries()) {
    if (now - createdAt > BURST_WINDOW_MS) {
      burstMap.delete(key);
    }
  }
}

function hasRecentBurst(key) {
  pruneBurstMap();
  const createdAt = burstMap.get(key);
  if (!createdAt) return false;
  return Date.now() - createdAt <= BURST_WINDOW_MS;
}

function markBurst(key) {
  burstMap.set(key, Date.now());
}

async function githubRequest(url, token, init = {}) {
  return fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {})
    }
  });
}

async function getRecentIndexCommits({ owner, repo, branch, token }) {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?sha=${encodeURIComponent(branch)}&path=${encodeURIComponent(INDEX_PATH)}&per_page=25`;
  const response = await githubRequest(url, token);
  if (!response.ok) return [];
  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
}

function detectCooldownHit(commits, appid, cooldownMs) {
  const now = Date.now();
  const matching = commits.find((commit) => {
    const message = String(commit?.commit?.message || "");
    if (!message.includes(`appid ${appid}`)) return false;
    const committedAt = Date.parse(commit?.commit?.author?.date || "");
    if (!Number.isFinite(committedAt)) return false;
    return now - committedAt <= cooldownMs;
  });

  if (!matching) return null;
  const committedAt = Date.parse(matching?.commit?.author?.date || "");
  return {
    sha: matching?.sha || null,
    nextAllowedAt: new Date(committedAt + cooldownMs).toISOString()
  };
}

async function getExistingIndex({ owner, repo, branch, token }) {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(INDEX_PATH)}?ref=${encodeURIComponent(branch)}`;
  const response = await githubRequest(url, token);

  if (response.status === 404) {
    return {
      exists: false,
      sha: null,
      data: {
        generated_at: new Date().toISOString(),
        source: "github_tree_index_live_merge",
        partial: false,
        sources: [],
        by_depotid: {},
        total_depots: 0,
        total_manifests: 0
      }
    };
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub read failed (${response.status}): ${text.slice(0, 280)}`);
  }

  const payload = await response.json();
  const encoded = String(payload?.content || "").replace(/\n/g, "");
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const parsed = JSON.parse(decoded);

  return {
    exists: true,
    sha: payload.sha,
    data: parsed
  };
}

function createEmptyIndex() {
  return {
    generated_at: new Date().toISOString(),
    source: "github_tree_index_live_merge",
    partial: false,
    sources: [],
    by_depotid: {},
    total_depots: 0,
    total_manifests: 0
  };
}

function mergeIndexData(existingData, incomingRows, sourceSummaries) {
  const base = existingData && typeof existingData === "object" ? existingData : createEmptyIndex();
  if (!base.by_depotid || typeof base.by_depotid !== "object") {
    base.by_depotid = {};
  }

  const seen = new Set();
  Object.keys(base.by_depotid).forEach((depotid) => {
    const bucket = Array.isArray(base.by_depotid[depotid]) ? base.by_depotid[depotid] : [];
    base.by_depotid[depotid] = bucket.filter((row) => {
      const item = normalizeManifestRow({ ...row, depotid });
      if (!item) return false;
      const key = `${item.depotid}:${item.manifestid}:${item.source_repo}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

  let added = 0;
  for (const row of incomingRows) {
    const item = normalizeManifestRow(row);
    if (!item) continue;
    const key = `${item.depotid}:${item.manifestid}:${item.source_repo}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (!Array.isArray(base.by_depotid[item.depotid])) {
      base.by_depotid[item.depotid] = [];
    }
    base.by_depotid[item.depotid].push(item);
    added += 1;
  }

  if (Array.isArray(sourceSummaries) && sourceSummaries.length) {
    base.sources = sourceSummaries.map((item) => ({
      source: normalizeValue(item?.source),
      truncated: Boolean(item?.partial || item?.truncated),
      manifests_found: Number(item?.found || item?.manifests_found || 0),
      updated_at: new Date().toISOString()
    }));
    base.partial = base.sources.some((source) => source.truncated);
  }

  base.generated_at = new Date().toISOString();
  base.total_depots = Object.keys(base.by_depotid).length;
  base.total_manifests = Object.values(base.by_depotid).reduce((sum, manifests) => {
    return sum + (Array.isArray(manifests) ? manifests.length : 0);
  }, 0);

  return {
    merged: base,
    added
  };
}

async function putIndexFile({ owner, repo, branch, token, sha, content, message }) {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(INDEX_PATH)}`;
  const body = {
    message,
    content: Buffer.from(content, "utf8").toString("base64"),
    branch
  };
  if (sha) {
    body.sha = sha;
  }

  const response = await githubRequest(url, token, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub write failed (${response.status}): ${text.slice(0, 280)}`);
  }

  return response.json();
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: buildCorsHeaders()
    };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  const origin = event?.headers?.origin || event?.headers?.Origin || "";
  if (!isOriginAllowed(origin)) {
    return json(403, { ok: false, error: "origin_not_allowed" });
  }

  const config = resolveRepoConfig();
  if (!config.owner || !config.repo || !config.token) {
    return json(500, { ok: false, error: "missing_github_configuration" });
  }

  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch (error) {
    return json(400, { ok: false, error: "invalid_json_body" });
  }

  const appid = normalizeValue(body?.appid);
  if (!/^\d+$/.test(appid)) {
    return json(400, { ok: false, error: "invalid_appid" });
  }

  const rows = Array.isArray(body?.results) ? body.results : [];
  if (!rows.length) {
    return json(200, { ok: true, status: "no_results", added: 0, committed: false });
  }
  if (rows.length > MAX_RESULTS_PER_REQUEST) {
    return json(400, { ok: false, error: "too_many_results", max: MAX_RESULTS_PER_REQUEST });
  }

  const normalizedRows = rows.map(normalizeManifestRow).filter(Boolean);
  if (!normalizedRows.length) {
    return json(400, { ok: false, error: "no_valid_manifest_rows" });
  }

  const ip = getClientIp(event);
  const burstKey = `${ip}:${appid}:persist`;
  if (hasRecentBurst(burstKey)) {
    return json(429, { ok: false, status: "blocked", error: "too_many_requests", retry_after_ms: BURST_WINDOW_MS });
  }
  markBurst(burstKey);

  try {
    const commits = await getRecentIndexCommits(config);
    const cooldownHit = detectCooldownHit(commits, appid, config.cooldownMs);
    if (cooldownHit) {
      return json(202, {
        ok: true,
        status: "cooldown",
        committed: false,
        added: 0,
        next_allowed_at: cooldownHit.nextAllowedAt
      });
    }

    const existing = await getExistingIndex(config);
    const merge = mergeIndexData(existing.data, normalizedRows, body?.source_summaries || []);
    if (merge.added <= 0) {
      return json(200, {
        ok: true,
        status: "no_changes",
        committed: false,
        added: 0,
        total_manifests: merge.merged.total_manifests
      });
    }

    const nextContent = `${JSON.stringify(merge.merged, null, 2)}\n`;
    const commitMessage = `chore(data): merge community manifests for appid ${appid} (+${merge.added})`;
    const putResponse = await putIndexFile({
      ...config,
      sha: existing.sha,
      content: nextContent,
      message: commitMessage
    });

    return json(200, {
      ok: true,
      status: "committed",
      committed: true,
      added: merge.added,
      total_manifests: merge.merged.total_manifests,
      commit_sha: putResponse?.commit?.sha || null
    });
  } catch (error) {
    return json(502, {
      ok: false,
      status: "error",
      error: "persist_failed",
      details: String(error?.message || "unknown_error")
    });
  }
}
