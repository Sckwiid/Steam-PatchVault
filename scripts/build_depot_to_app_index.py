#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from typing import Any

from config import (
    APPINFO_SNAPSHOTS_DIR,
    APP_TO_DEPOTS_INDEX_FILE,
    DEPOT_TO_APP_INDEX_FILE,
    IMPORT_STATS_FILE,
    MANIFESTS_DIR,
)
from utils import now_iso, read_json, to_string_appid, write_json


def log(message: str) -> None:
    print(f"[build_depot_to_app_index] {message}")


def latest_snapshot_file(appid_dir: Path) -> Path | None:
    files = sorted((item for item in appid_dir.glob("*.json") if item.is_file()), key=lambda item: item.name)
    return files[-1] if files else None


def normalize_entry(
    appid: str,
    game_name: str,
    depot: dict[str, Any],
    scanned_at: str,
    existing_first_seen: str | None,
    existing_last_seen: str | None,
) -> dict[str, Any]:
    return {
        "depotid": to_string_appid(depot.get("depotid")),
        "depot_name": str(depot.get("depot_name") or depot.get("name") or f"{game_name} Depot"),
        "os": str(depot.get("os") or "all"),
        "language": str(depot.get("language") or "all"),
        "source": "steam_appinfo_pics",
        "confidence_score": int(depot.get("confidence_score") or 90),
        "first_seen_at": existing_first_seen or scanned_at,
        "last_seen_at": scanned_at if scanned_at else (existing_last_seen or now_iso()),
        "appid": appid,
        "game_name": game_name,
    }


def load_existing_histories() -> tuple[dict[str, dict[str, dict[str, str]]], dict[str, dict[str, dict[str, str]]]]:
    app_index = read_json(APP_TO_DEPOTS_INDEX_FILE, {})
    depot_index = read_json(DEPOT_TO_APP_INDEX_FILE, {})

    app_history: dict[str, dict[str, dict[str, str]]] = {}
    depot_history: dict[str, dict[str, dict[str, str]]] = {}

    for appid, app_payload in (app_index.items() if isinstance(app_index, dict) else []):
        if not isinstance(app_payload, dict):
            continue
        for depot in app_payload.get("depots", []):
            depotid = to_string_appid((depot or {}).get("depotid"))
            if not depotid:
                continue
            app_history.setdefault(str(appid), {})[depotid] = {
                "first_seen_at": str((depot or {}).get("first_seen_at") or ""),
                "last_seen_at": str((depot or {}).get("last_seen_at") or ""),
            }

    for depotid, matches in (depot_index.items() if isinstance(depot_index, dict) else []):
        if not isinstance(matches, list):
            continue
        for match in matches:
            appid = to_string_appid((match or {}).get("appid"))
            if not appid:
                continue
            depot_history.setdefault(str(depotid), {})[appid] = {
                "first_seen_at": str((match or {}).get("first_seen_at") or ""),
                "last_seen_at": str((match or {}).get("last_seen_at") or ""),
            }

    return app_history, depot_history


def update_import_stats(apps: int, depots: int, apps_with_manifests: int) -> None:
    stats = read_json(IMPORT_STATS_FILE, {})
    stats.update(
        {
            "generated_at": now_iso(),
            "apps_scanned": int(stats.get("apps_scanned", 0)),
            "depots_indexed": depots,
            "github_manifests_imported": int(stats.get("github_manifests_imported", 0)),
            "github_manifests_mapped": int(stats.get("github_manifests_mapped", 0)),
            "github_manifests_unmapped": int(stats.get("github_manifests_unmapped", 0)),
            "apps_with_manifests": apps_with_manifests,
            "apps_with_depots": apps,
        }
    )
    write_json(IMPORT_STATS_FILE, stats)


def main() -> int:
    app_history, depot_history = load_existing_histories()
    generated_at = now_iso()

    app_to_depots: dict[str, dict[str, Any]] = {}
    depot_to_app: dict[str, list[dict[str, Any]]] = {}

    if not APPINFO_SNAPSHOTS_DIR.exists():
        write_json(APP_TO_DEPOTS_INDEX_FILE, {})
        write_json(DEPOT_TO_APP_INDEX_FILE, {})
        update_import_stats(0, 0, 0)
        return 0

    for appid_dir in sorted(item for item in APPINFO_SNAPSHOTS_DIR.iterdir() if item.is_dir()):
        appid = to_string_appid(appid_dir.name)
        if not appid:
            continue
        snapshot_file = latest_snapshot_file(appid_dir)
        if not snapshot_file:
            continue

        snapshot = read_json(snapshot_file, {})
        depots = snapshot.get("depots") or []
        game_name = str(snapshot.get("game_name") or f"Steam App {appid}")
        scanned_at = str(snapshot.get("scanned_at") or generated_at)

        app_payload = {
            "appid": appid,
            "game_name": game_name,
            "depots": [],
            "last_scanned_at": scanned_at,
            "source": "steam_appinfo_pics",
        }

        for depot in depots:
            depotid = to_string_appid((depot or {}).get("depotid"))
            if not depotid:
                continue
            existing_app = app_history.get(appid, {}).get(depotid, {})
            existing_depot = depot_history.get(depotid, {}).get(appid, {})
            first_seen = existing_app.get("first_seen_at") or existing_depot.get("first_seen_at")
            last_seen = existing_app.get("last_seen_at") or existing_depot.get("last_seen_at")
            entry = normalize_entry(appid, game_name, depot, scanned_at, first_seen, last_seen)
            app_payload["depots"].append(
                {
                    "depotid": entry["depotid"],
                    "depot_name": entry["depot_name"],
                    "os": entry["os"],
                    "language": entry["language"],
                    "source": entry["source"],
                    "confidence_score": entry["confidence_score"],
                    "first_seen_at": entry["first_seen_at"],
                    "last_seen_at": entry["last_seen_at"],
                }
            )
            depot_to_app.setdefault(depotid, []).append(
                {
                    "appid": appid,
                    "game_name": game_name,
                    "depot_name": entry["depot_name"],
                    "source": entry["source"],
                    "confidence_score": entry["confidence_score"],
                    "first_seen_at": entry["first_seen_at"],
                    "last_seen_at": entry["last_seen_at"],
                }
            )

        app_payload["depots"].sort(key=lambda item: int(item["depotid"]))
        app_to_depots[appid] = app_payload

    # Keep only deterministic ordering.
    depot_to_app_sorted = {
        depotid: sorted(matches, key=lambda item: (int(item["appid"]), item["depot_name"]))
        for depotid, matches in sorted(depot_to_app.items(), key=lambda pair: int(pair[0]))
    }
    app_to_depots_sorted = {
        appid: app_to_depots[appid] for appid in sorted(app_to_depots.keys(), key=int)
    }

    write_json(APP_TO_DEPOTS_INDEX_FILE, app_to_depots_sorted)
    write_json(DEPOT_TO_APP_INDEX_FILE, depot_to_app_sorted)

    apps_with_manifests = 0
    for appid in app_to_depots_sorted.keys():
        manifest_file = MANIFESTS_DIR / f"{appid}.json"
        payload = read_json(manifest_file, {})
        depots = payload.get("depots") if isinstance(payload, dict) else []
        if any((depot or {}).get("manifests") for depot in (depots or [])):
            apps_with_manifests += 1

    total_depots = sum(len(payload.get("depots", [])) for payload in app_to_depots_sorted.values())
    update_import_stats(len(app_to_depots_sorted), total_depots, apps_with_manifests)
    log(f"apps={len(app_to_depots_sorted)} depots={total_depots}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

