const DEFAULT_WORKFLOW_FILE = "scan-appinfo-pics.yml";
const DEFAULT_REF = "main";
const DEFAULT_COOLDOWN_MINUTES = 360;
const MEMORY_BURST_WINDOW_MS = 20 * 1000;

const memoryBurstGuard = new Map();

function json(statusCode, payload) {
  const corsHeaders = buildCorsHeaders();
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders
    },
    body: JSON.stringify(payload)
  };
}

function buildCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": process.env.SCAN_CORS_ORIGIN || "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
}

function isOriginAllowed(originValue) {
  const configured = String(process.env.SCAN_ALLOWED_ORIGINS || "").trim();
  if (!configured) return true;

  const allowedOrigins = configured
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (!allowedOrigins.length) return true;
  return allowedOrigins.includes(String(originValue || "").trim());
}

function resolveRepoConfig() {
  const explicitOwner = String(process.env.GITHUB_OWNER || "").trim();
  const explicitRepo = String(process.env.GITHUB_REPO || "").trim();
  const fallbackRepository = String(process.env.GITHUB_REPOSITORY || "").trim();
  const token = String(process.env.GITHUB_PAT || process.env.GITHUB_TOKEN || "").trim();
  const workflowFile = String(process.env.GITHUB_SCAN_WORKFLOW || DEFAULT_WORKFLOW_FILE).trim();
  const ref = String(process.env.GITHUB_SCAN_REF || DEFAULT_REF).trim();
  const cooldownMinutes = Number(process.env.SCAN_COOLDOWN_MINUTES || DEFAULT_COOLDOWN_MINUTES);

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
    workflowFile,
    ref,
    cooldownMs: Math.max(15 * 60 * 1000, Math.floor(cooldownMinutes * 60 * 1000))
  };
}

function parseRequestedAppId(rawValue) {
  const value = String(rawValue || "").trim();
  if (!/^\d{2,10}$/.test(value)) return "";
  return value;
}

function getClientIp(event) {
  return (
    event?.headers?.["x-nf-client-connection-ip"] ||
    event?.headers?.["client-ip"] ||
    event?.headers?.["x-forwarded-for"] ||
    "unknown"
  );
}

function parseAppIdFromRun(run) {
  const candidates = [
    run?.display_title,
    run?.name,
    run?.head_commit?.message
  ];

  for (const candidate of candidates) {
    const match = String(candidate || "").match(/\b(\d{2,10})\b/);
    if (match) return match[1];
  }

  return "";
}

function pruneBurstMemory() {
  const now = Date.now();
  for (const [key, value] of memoryBurstGuard.entries()) {
    if (!value || now - value > MEMORY_BURST_WINDOW_MS) {
      memoryBurstGuard.delete(key);
    }
  }
}

function hasRecentBurst(key) {
  pruneBurstMemory();
  const previous = memoryBurstGuard.get(key);
  if (!previous) return false;
  return Date.now() - previous <= MEMORY_BURST_WINDOW_MS;
}

function setBurst(key) {
  memoryBurstGuard.set(key, Date.now());
}

async function githubRequest(url, token, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {})
    }
  });

  return response;
}

async function getRecentWorkflowRuns({ owner, repo, workflowFile, token }) {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflowFile)}/runs?event=workflow_dispatch&per_page=30`;
  const response = await githubRequest(url, token);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub runs API failed (${response.status}): ${text.slice(0, 280)}`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : [];
}

function evaluateRateLimitForAppId(runs, appid, cooldownMs) {
  const now = Date.now();

  const sameAppRuns = runs.filter((run) => parseAppIdFromRun(run) === appid);
  const running = sameAppRuns.find((run) => run?.status === "queued" || run?.status === "in_progress");
  if (running) {
    return {
      status: "already-running",
      run_id: running.id || null
    };
  }

  const recent = sameAppRuns.find((run) => {
    const createdAt = Date.parse(run?.created_at || "");
    if (!Number.isFinite(createdAt)) return false;
    return now - createdAt <= cooldownMs;
  });

  if (recent) {
    const nextAllowedAt = new Date(Date.parse(recent.created_at) + cooldownMs).toISOString();
    return {
      status: "cooldown",
      run_id: recent.id || null,
      next_allowed_at: nextAllowedAt
    };
  }

  return null;
}

async function dispatchWorkflow({ owner, repo, workflowFile, token, ref, appid }) {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`;
  const response = await githubRequest(url, token, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({
      ref,
      inputs: {
        appid: String(appid)
      }
    })
  });

  if (response.status === 204) return;
  const text = await response.text();
  throw new Error(`GitHub dispatch failed (${response.status}): ${text.slice(0, 280)}`);
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

  const appid = parseRequestedAppId(body?.appid);
  if (!appid) {
    return json(400, { ok: false, error: "invalid_appid" });
  }

  const ip = getClientIp(event);
  const burstKey = `${ip}:${appid}`;
  if (hasRecentBurst(burstKey)) {
    return json(429, {
      ok: false,
      status: "blocked",
      error: "too_many_requests",
      cooldown_ms: MEMORY_BURST_WINDOW_MS
    });
  }
  setBurst(burstKey);

  try {
    const runs = await getRecentWorkflowRuns(config);
    const limited = evaluateRateLimitForAppId(runs, appid, config.cooldownMs);
    if (limited) {
      return json(202, {
        ok: true,
        status: limited.status,
        run_id: limited.run_id || null,
        next_allowed_at: limited.next_allowed_at || null,
        cooldown_ms: config.cooldownMs
      });
    }

    await dispatchWorkflow({
      owner: config.owner,
      repo: config.repo,
      workflowFile: config.workflowFile,
      token: config.token,
      ref: config.ref,
      appid
    });

    return json(202, {
      ok: true,
      status: "queued",
      cooldown_ms: config.cooldownMs
    });
  } catch (error) {
    return json(502, {
      ok: false,
      status: "error",
      error: "github_dispatch_failed",
      details: String(error?.message || "unknown_error")
    });
  }
}
