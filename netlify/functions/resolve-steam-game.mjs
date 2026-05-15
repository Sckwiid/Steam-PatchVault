function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": process.env.SCAN_CORS_ORIGIN || "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, OPTIONS"
    },
    body: JSON.stringify(payload)
  };
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function slugify(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function detectPatchType(text) {
  const value = normalizeText(text);
  if (/hotfix|fix|crash|bug/.test(value)) return "hotfix";
  if (/balance|nerf|buff|equilibr/.test(value)) return "balance";
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
  const source = normalizeText(`${title || ""} ${content || ""}`);
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

function toIsoFromUnix(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return new Date().toISOString();
  return new Date(numeric * 1000).toISOString();
}

function guessTermFromSlug(slug) {
  return String(slug || "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickBestSearchResult(items, query) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return null;
  const normalizedQuery = normalizeText(query);

  const scored = list
    .map((item) => {
      const name = String(item?.name || "");
      const normalizedName = normalizeText(name);
      let score = 0;
      if (normalizedName === normalizedQuery) score += 100;
      if (normalizedName.startsWith(normalizedQuery)) score += 70;
      if (normalizedName.includes(normalizedQuery)) score += 50;
      score -= Math.abs(normalizedName.length - normalizedQuery.length) * 0.2;
      return { item, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.item || null;
}

async function fetchJson(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Steam-PatchVault-Netlify-Resolver"
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function resolveGameBySearch(term) {
  const url = new URL("https://store.steampowered.com/api/storesearch/");
  url.searchParams.set("term", term);
  url.searchParams.set("l", "english");
  url.searchParams.set("cc", "us");

  const payload = await fetchJson(url.toString());
  const item = pickBestSearchResult(payload?.items || [], term);
  if (!item || !item.id) return null;

  return {
    appid: Number(item.id),
    name: String(item.name || term).trim(),
    header_image: item.tiny_image || `https://cdn.akamai.steamstatic.com/steam/apps/${item.id}/header.jpg`
  };
}

async function resolveGameByAppId(appid) {
  const url = new URL("https://store.steampowered.com/api/appdetails");
  url.searchParams.set("appids", String(appid));
  url.searchParams.set("l", "english");
  url.searchParams.set("cc", "us");

  const payload = await fetchJson(url.toString());
  const details = payload?.[String(appid)];
  if (!details?.success) return null;
  const data = details.data || {};

  return {
    appid: Number(appid),
    name: String(data.name || `Steam App ${appid}`).trim(),
    header_image: data.header_image || `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`,
    description: stripHtml(data.short_description || data.about_the_game || ""),
    genres: Array.isArray(data.genres) ? data.genres.map((genre) => String(genre.description || "").trim()).filter(Boolean) : []
  };
}

async function fetchNews(appid) {
  const url = new URL("https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/");
  url.searchParams.set("appid", String(appid));
  url.searchParams.set("count", "8");
  url.searchParams.set("maxlength", "2400");
  url.searchParams.set("feeds", "steam_community_announcements");

  const payload = await fetchJson(url.toString());
  const items = payload?.appnews?.newsitems || [];

  return items.map((item) => {
    const title = String(item?.title || "Steam News").trim();
    const content = stripHtml(item?.contents || "");
    const gid = String(item?.gid || "");
    const sourceUrl = item?.url || `https://store.steampowered.com/news/app/${appid}`;

    return {
      id: `steam-news-${appid}-${gid || Math.abs(Date.parse(toIsoFromUnix(item?.date || 0)))}`,
      appid: Number(appid),
      title,
      version_detected: detectVersion(`${title} ${content}`),
      date: toIsoFromUnix(item?.date),
      type: detectPatchType(`${title} ${content}`),
      content,
      source_url: sourceUrl,
      source_type: "steam_news",
      keywords: extractKeywords(title, content)
    };
  });
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": process.env.SCAN_CORS_ORIGIN || "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS"
      }
    };
  }

  if (event.httpMethod !== "GET") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  const params = event.queryStringParameters || {};
  const slug = String(params.slug || "").trim();
  const rawAppId = String(params.appid || "").trim();
  const appid = /^\d+$/.test(rawAppId) ? Number(rawAppId) : null;

  if (!slug && !appid) {
    return json(400, { ok: false, error: "missing_slug_or_appid" });
  }

  try {
    let game = null;

    if (appid) {
      game = await resolveGameByAppId(appid);
    } else {
      const guessTerm = guessTermFromSlug(slug);
      const searched = await resolveGameBySearch(guessTerm);
      if (searched?.appid) {
        const details = await resolveGameByAppId(searched.appid);
        game = Object.assign({}, searched, details || {});
      }
    }

    if (!game || !game.appid) {
      return json(404, { ok: false, error: "steam_game_not_found" });
    }

    const patches = await fetchNews(game.appid);
    const normalizedSlug = slugify(game.name);
    const tags = (game.genres || []).slice(0, 4);

    return json(200, {
      ok: true,
      source: "steam_live_resolver",
      game: {
        appid: Number(game.appid),
        name: game.name,
        slug: normalizedSlug,
        header_image: game.header_image || `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/header.jpg`,
        description: game.description || `Fiche live générée depuis Steam pour ${game.name}.`,
        tags,
        last_synced_at: new Date().toISOString(),
        bucket: normalizedSlug.charAt(0).match(/[a-z]/) ? normalizedSlug.charAt(0) : "0-9",
        live_source: true
      },
      patches
    });
  } catch (error) {
    return json(502, {
      ok: false,
      error: "steam_resolve_failed",
      details: String(error?.message || "unknown_error")
    });
  }
}
