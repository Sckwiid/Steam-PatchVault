#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from typing import Any

from config import (
    COMMUNITY_MANIFEST_INDEX_FILE,
    DEPOT_TO_APP_INDEX_FILE,
    IMPORT_STATS_FILE,
    MANIFESTS_DIR,
    UNMAPPED_MANIFESTS_DIR,
)
from utils import now_iso, read_json, to_string_appid, write_json


def log(message: str) -> None:
    print(f"[merge_github_manifests_with_depots] {message}")


def load_community_items() -> list[dict[str, Any]]:
    payload = read_json(COMMUNITY_MANIFEST_INDEX_FILE, [])
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]

    if isinstance(payload, dict):
        if isinstance(payload.get("by_depotid"), dict):
            items: list[dict[str, Any]] = []
            for depotid, manifests in payload["by_depotid"].items():
                for manifest in manifests or []:
                    if not isinstance(manifest, dict):
                        continue
                    enriched = dict(manifest)
                    enriched["depotid"] = to_string_appid(enriched.get("depotid") or depotid)
                    items.append(enriched)
            return items
        if isinstance(payload.get("manifests"), list):
            return [item for item in payload["manifests"] if isinstance(item, dict)]
    return []


def normalize_manifest_item(item: dict[str, Any]) -> dict[str, Any] | None:
    depotid = to_string_appid(item.get("depotid"))
    manifestid = "".join(ch for ch in str(item.get("manifestid") or "") if ch.isdigit())
    if not depotid or not manifestid:
        return None
    return {
        "depotid": depotid,
        "manifestid": manifestid,
        "source_repo": str(item.get("source_repo") or ""),
        "source_type": str(item.get("source_type") or "github_filename_index"),
        "status": str(item.get("status") or "community_unverified"),
        "confidence_score": int(item.get("confidence_score") or 25),
    }


def load_manifest_file(appid: str, game_name: str) -> dict[str, Any]:
    path = MANIFESTS_DIR / f"{appid}.json"
    payload = read_json(
        path,
        {
            "appid": appid,
            "game_name": game_name,
            "tracked_since": now_iso(),
            "depots": [],
        },
    )
    if not isinstance(payload, dict):
        payload = {
            "appid": appid,
            "game_name": game_name,
            "tracked_since": now_iso(),
            "depots": [],
        }
    payload["appid"] = str(payload.get("appid") or appid)
    payload["game_name"] = str(payload.get("game_name") or game_name)
    if not isinstance(payload.get("depots"), list):
        payload["depots"] = []
    return payload


def ensure_depot_entry(manifest_file: dict[str, Any], depotid: str, depot_name: str) -> dict[str, Any]:
    depots = manifest_file.setdefault("depots", [])
    for depot in depots:
        if to_string_appid((depot or {}).get("depotid")) == depotid:
            return depot
    depot = {
        "depotid": depotid,
        "depot_name": depot_name or f"Depot {depotid}",
        "os": "all",
        "language": "all",
        "manifests": [],
    }
    depots.append(depot)
    return depot


def upsert_community_manifest(manifest_file: dict[str, Any], depotid: str, depot_name: str, appid: str, item: dict[str, Any], scanned_at: str) -> bool:
    depot = ensure_depot_entry(manifest_file, depotid, depot_name)
    manifests = depot.setdefault("manifests", [])
    target_key = (item["manifestid"], "public")

    for existing in manifests:
        existing_key = (str(existing.get("manifestid") or ""), str(existing.get("branch") or "public"))
        if existing_key != target_key:
            continue
        existing["last_seen_at"] = scanned_at
        existing["source"] = existing.get("source") or "github_filename_index"
        existing["status"] = "community_unverified"
        existing["confidence_score"] = max(int(existing.get("confidence_score", 0)), int(item.get("confidence_score", 25)))
        existing.setdefault("download_command", f"download_depot {appid} {depotid} {item['manifestid']}")
        return False

    manifests.append(
        {
            "manifestid": item["manifestid"],
            "buildid": None,
            "branch": "public",
            "first_seen_at": scanned_at,
            "last_seen_at": scanned_at,
            "source": item["source_type"],
            "source_repo": item.get("source_repo") or "",
            "status": "community_unverified",
            "confidence_score": int(item["confidence_score"]),
            "download_command": f"download_depot {appid} {depotid} {item['manifestid']}",
            "notes": "Manifest communautaire non vérifié. ManifestID connu ≠ téléchargement garanti.",
        }
    )
    return True


def write_unmapped(depotid: str, item: dict[str, Any], scanned_at: str) -> None:
    path = UNMAPPED_MANIFESTS_DIR / f"{depotid}.json"
    payload = read_json(path, {"depotid": depotid, "updated_at": scanned_at, "manifests": []})
    manifests = payload.setdefault("manifests", [])
    key = f"{item['depotid']}:{item['manifestid']}"
    known = {f"{entry.get('depotid')}:{entry.get('manifestid')}" for entry in manifests}
    if key not in known:
        manifests.append(item)
    payload["updated_at"] = scanned_at
    write_json(path, payload)


def update_import_stats(total_imported: int, mapped: int, unmapped: int) -> None:
    stats = read_json(IMPORT_STATS_FILE, {})
    stats.update(
        {
            "generated_at": now_iso(),
            "apps_scanned": int(stats.get("apps_scanned", 0)),
            "depots_indexed": int(stats.get("depots_indexed", 0)),
            "github_manifests_imported": total_imported,
            "github_manifests_mapped": mapped,
            "github_manifests_unmapped": unmapped,
            "apps_with_manifests": int(stats.get("apps_with_manifests", 0)),
        }
    )
    write_json(IMPORT_STATS_FILE, stats)


def main() -> int:
    scanned_at = now_iso()
    depot_to_app = read_json(DEPOT_TO_APP_INDEX_FILE, {})
    items = [normalized for normalized in (normalize_manifest_item(item) for item in load_community_items()) if normalized]

    manifest_cache: dict[str, dict[str, Any]] = {}
    changed_appids: set[str] = set()

    total_imported = len(items)
    mapped = 0
    unmapped = 0

    for item in items:
        depotid = item["depotid"]
        matches = depot_to_app.get(depotid) if isinstance(depot_to_app, dict) else None
        if not isinstance(matches, list) or not matches:
            write_unmapped(depotid, item, scanned_at)
            unmapped += 1
            continue

        mapped += 1
        for match in matches:
            appid = to_string_appid((match or {}).get("appid"))
            if not appid:
                continue
            game_name = str((match or {}).get("game_name") or f"Steam App {appid}")
            depot_name = str((match or {}).get("depot_name") or f"Depot {depotid}")
            manifest_file = manifest_cache.get(appid)
            if manifest_file is None:
                manifest_file = load_manifest_file(appid, game_name)
                manifest_cache[appid] = manifest_file
            if upsert_community_manifest(manifest_file, depotid, depot_name, appid, item, scanned_at):
                changed_appids.add(appid)

    for appid, payload in manifest_cache.items():
        payload["last_scanned_at"] = scanned_at
        payload["source"] = "hybrid_appinfo_community"
        payload["notes"] = "Manifests issus de scans appinfo/PICS et d'index communautaires. ManifestID connu ≠ téléchargement garanti."
        payload["depots"].sort(key=lambda depot: int(to_string_appid(depot.get("depotid")) or 0))
        write_json(MANIFESTS_DIR / f"{appid}.json", payload)

    update_import_stats(total_imported, mapped, unmapped)
    log(f"imported={total_imported} mapped={mapped} unmapped={unmapped} apps_changed={len(changed_appids)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

