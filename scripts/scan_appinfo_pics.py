#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

from config import (
    APPINFO_SNAPSHOTS_DIR,
    DEFAULT_BRANCH,
    DEFAULT_SCAN_LIMIT,
    IMPORT_STATS_FILE,
    MANIFESTS_DIR,
    MOCK_APPINFO_DIR,
    PRIORITY_APPIDS_FILE,
    SEARCH_INDEX_FILE,
)
from utils import (
    now_file_stamp,
    now_iso,
    parse_workflow_input_appids,
    read_json,
    to_string_appid,
    unique_preserve_order,
    write_json,
)


def log(message: str) -> None:
    print(f"[scan_appinfo_pics] {message}")


def load_target_appids(input_appids: list[str], limit: int) -> list[str]:
    ordered: list[str] = []
    ordered.extend(input_appids)

    priority = read_json(PRIORITY_APPIDS_FILE, [])
    for item in priority:
        if isinstance(item, dict):
            appid = to_string_appid(item.get("appid"))
        else:
            appid = to_string_appid(item)
        if appid:
            ordered.append(appid)

    search_index = read_json(SEARCH_INDEX_FILE, {"games": []})
    for game in (search_index.get("games") or [])[:limit]:
        appid = to_string_appid(game.get("appid"))
        if appid:
            ordered.append(appid)

    return unique_preserve_order(ordered)


def normalize_manifest_entries(raw_manifests: Any) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []

    if isinstance(raw_manifests, list):
        for item in raw_manifests:
            manifestid = "".join(ch for ch in str((item or {}).get("manifestid", "")) if ch.isdigit())
            if not manifestid:
                continue
            output.append(
                {
                    "manifestid": manifestid,
                    "branch": str((item or {}).get("branch") or DEFAULT_BRANCH),
                    "buildid": (item or {}).get("buildid"),
                }
            )
        return output

    if isinstance(raw_manifests, dict):
        for branch, value in raw_manifests.items():
            branch_name = str(branch or DEFAULT_BRANCH)
            if isinstance(value, dict):
                manifestid = "".join(ch for ch in str(value.get("manifestid") or value.get("gid") or value.get("value") or "") if ch.isdigit())
                buildid = value.get("buildid")
            else:
                manifestid = "".join(ch for ch in str(value or "") if ch.isdigit())
                buildid = None

            if not manifestid:
                continue

            output.append(
                {
                    "manifestid": manifestid,
                    "branch": branch_name,
                    "buildid": buildid,
                }
            )
    return output


def normalize_depots(raw_depots: Any, game_name: str) -> list[dict[str, Any]]:
    depots: list[dict[str, Any]] = []

    if isinstance(raw_depots, list):
        items = {}
        for item in raw_depots:
            if not isinstance(item, dict):
                continue
            depotid = to_string_appid(item.get("depotid"))
            if depotid:
                items[depotid] = item
    elif isinstance(raw_depots, dict):
        items = {str(key): value for key, value in raw_depots.items()}
    else:
        items = {}

    for depotid_key, depot_value in items.items():
        depotid = to_string_appid(depotid_key)
        if not depotid:
            depotid = to_string_appid((depot_value or {}).get("depotid"))
        if not depotid:
            continue

        value = depot_value if isinstance(depot_value, dict) else {}
        config = value.get("config") if isinstance(value.get("config"), dict) else {}
        depot_name = str(
            value.get("name")
            or value.get("depot_name")
            or f"{game_name} Depot {depotid}"
        )
        os_name = str(
            value.get("os")
            or value.get("oslist")
            or config.get("os")
            or config.get("oslist")
            or "all"
        )
        language = str(
            value.get("language")
            or value.get("lang")
            or config.get("language")
            or "all"
        )
        manifests = normalize_manifest_entries(value.get("manifests"))
        depots.append(
            {
                "depotid": depotid,
                "depot_name": depot_name,
                "os": os_name,
                "language": language,
                "manifests": manifests,
            }
        )

    depots.sort(key=lambda item: int(item["depotid"]))
    return depots


def normalize_appinfo_payload(raw: Any, appid: str, source: str) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None

    appinfo = raw.get("appinfo") if isinstance(raw.get("appinfo"), dict) else raw
    common = appinfo.get("common") if isinstance(appinfo.get("common"), dict) else {}
    depots_raw = appinfo.get("depots") if appinfo.get("depots") is not None else raw.get("depots")

    game_name = str(
        appinfo.get("game_name")
        or appinfo.get("name")
        or common.get("name")
        or raw.get("game_name")
        or f"Steam App {appid}"
    )
    depots = normalize_depots(depots_raw, game_name)

    return {
        "appid": appid,
        "game_name": game_name,
        "source": source,
        "scanned_at": now_iso(),
        "depots": depots,
    }


def parse_simple_keyvalues(raw_text: str) -> dict[str, Any]:
    tokens = re.findall(r'"(?:\\.|[^"])*"|[{}]', raw_text)
    root: dict[str, Any] = {}
    stack: list[dict[str, Any]] = [root]
    key_stack: list[str | None] = [None]

    def assign_value(target: dict[str, Any], key: str, value: Any) -> None:
        if key not in target:
            target[key] = value
            return
        if isinstance(target[key], list):
            target[key].append(value)
            return
        target[key] = [target[key], value]

    for token in tokens:
        if token == "{":
            parent = stack[-1]
            key = key_stack[-1]
            child: dict[str, Any] = {}
            if key is not None:
                assign_value(parent, key, child)
                key_stack[-1] = None
            stack.append(child)
            key_stack.append(None)
            continue

        if token == "}":
            if len(stack) > 1:
                stack.pop()
                key_stack.pop()
            continue

        value = token[1:-1]
        current_key = key_stack[-1]
        if current_key is None:
            key_stack[-1] = value
        else:
            assign_value(stack[-1], current_key, value)
            key_stack[-1] = None

    return root


def scan_with_steamcmd_binary(appid: str) -> dict[str, Any] | None:
    steamcmd_path = shutil.which("steamcmd")
    if not steamcmd_path:
        return None

    command = [
        steamcmd_path,
        "+login",
        "anonymous",
        "+app_info_print",
        appid,
        "+quit",
    ]
    process = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        timeout=120,
    )
    if process.returncode != 0:
        return None

    parsed = parse_simple_keyvalues(process.stdout)
    app_payload = parsed.get(appid) if isinstance(parsed.get(appid), dict) else None
    if not app_payload and isinstance(parsed.get("appinfo"), dict):
        app_payload = parsed["appinfo"]
    if not app_payload:
        app_payload = parsed

    return normalize_appinfo_payload(app_payload, appid, "steamcmd_app_info_print")


def scan_with_steam_pics_api(appid: str) -> dict[str, Any] | None:
    try:
        import steam_pics_api  # type: ignore
    except Exception:
        return None

    try:
        if hasattr(steam_pics_api, "get_appinfo"):
            raw = steam_pics_api.get_appinfo(int(appid))  # type: ignore[attr-defined]
        elif hasattr(steam_pics_api, "SteamPicsAPI"):
            client = steam_pics_api.SteamPicsAPI()  # type: ignore[attr-defined]
            raw = client.get_appinfo(int(appid))
        else:
            return None
    except Exception:
        return None

    return normalize_appinfo_payload(raw, appid, "steam_appinfo_pics")


def scan_with_steamkit_python(appid: str) -> dict[str, Any] | None:
    # Placeholder hook: a proper SteamKit client can be plugged here later.
    # Keeping this function explicit makes provider ordering clear.
    return None


def scan_with_mock_file(appid: str) -> dict[str, Any] | None:
    mock_file = MOCK_APPINFO_DIR / f"{appid}.json"
    raw = read_json(mock_file, None)
    if raw is None:
        return None
    return normalize_appinfo_payload(raw, appid, "mock_appinfo")


def upsert_manifest_history(snapshot: dict[str, Any]) -> None:
    appid = str(snapshot["appid"])
    game_name = snapshot["game_name"]
    scanned_at = snapshot["scanned_at"]
    manifest_file = MANIFESTS_DIR / f"{appid}.json"

    existing = read_json(
        manifest_file,
        {
            "appid": appid,
            "game_name": game_name,
            "tracked_since": scanned_at,
            "depots": [],
        },
    )

    tracked_since = existing.get("tracked_since") or scanned_at
    existing_map: dict[tuple[str, str, str], dict[str, Any]] = {}

    for depot in existing.get("depots", []):
        depotid = to_string_appid(depot.get("depotid"))
        for manifest in depot.get("manifests", []):
            manifestid = "".join(ch for ch in str(manifest.get("manifestid", "")) if ch.isdigit())
            branch = str(manifest.get("branch") or DEFAULT_BRANCH)
            if depotid and manifestid:
                existing_map[(depotid, manifestid, branch)] = manifest

    depot_records: dict[str, dict[str, Any]] = {}
    for depot in snapshot.get("depots", []):
        depotid = to_string_appid(depot.get("depotid"))
        if not depotid:
            continue
        depot_records[depotid] = {
            "depotid": depotid,
            "depot_name": str(depot.get("depot_name") or f"{game_name} Depot {depotid}"),
            "os": str(depot.get("os") or "all"),
            "language": str(depot.get("language") or "all"),
            "manifests": [],
        }

        for manifest in depot.get("manifests", []):
            manifestid = "".join(ch for ch in str(manifest.get("manifestid", "")) if ch.isdigit())
            if not manifestid:
                continue
            branch = str(manifest.get("branch") or DEFAULT_BRANCH)
            key = (depotid, manifestid, branch)
            previous = existing_map.get(key, {})
            first_seen = previous.get("first_seen_at") or scanned_at
            item = {
                "manifestid": manifestid,
                "buildid": manifest.get("buildid"),
                "branch": branch,
                "first_seen_at": first_seen,
                "last_seen_at": scanned_at,
                "source": "steam_appinfo_pics",
                "status": "auto_detected_unverified",
                "confidence_score": max(int(previous.get("confidence_score", 0)), 60),
                "download_command": f"download_depot {appid} {depotid} {manifestid}",
                "notes": "Manifest connu, téléchargement non garanti.",
            }
            depot_records[depotid]["manifests"].append(item)

    # Preserve previously known manifests even if current scan no longer exposes them.
    for depot in existing.get("depots", []):
        depotid = to_string_appid(depot.get("depotid"))
        if not depotid:
            continue
        if depotid not in depot_records:
            depot_records[depotid] = {
                "depotid": depotid,
                "depot_name": str(depot.get("depot_name") or depot.get("name") or f"{game_name} Depot {depotid}"),
                "os": str(depot.get("os") or "all"),
                "language": str(depot.get("language") or "all"),
                "manifests": [],
            }

        known_keys = {
            (to_string_appid(depotid), str(item.get("manifestid")), str(item.get("branch") or DEFAULT_BRANCH))
            for item in depot_records[depotid]["manifests"]
        }

        for manifest in depot.get("manifests", []):
            manifestid = "".join(ch for ch in str(manifest.get("manifestid", "")) if ch.isdigit())
            branch = str(manifest.get("branch") or DEFAULT_BRANCH)
            key = (depotid, manifestid, branch)
            if not manifestid or key in known_keys:
                continue
            preserved = dict(manifest)
            preserved.setdefault("first_seen_at", scanned_at)
            preserved.setdefault("last_seen_at", scanned_at)
            depot_records[depotid]["manifests"].append(preserved)

    output = {
        "appid": appid,
        "game_name": game_name,
        "last_scanned_at": scanned_at,
        "tracked_since": tracked_since,
        "source": "steam_appinfo_pics",
        "depots": sorted(depot_records.values(), key=lambda item: int(item["depotid"])),
        "notes": "Manifests issus de scans appinfo/PICS et d'historique local. ManifestID connu ≠ téléchargement garanti.",
    }
    write_json(manifest_file, output)


def update_import_stats(apps_scanned: int) -> None:
    stats = read_json(IMPORT_STATS_FILE, {})
    stats.update(
        {
            "generated_at": now_iso(),
            "apps_scanned": apps_scanned,
            "depots_indexed": int(stats.get("depots_indexed", 0)),
            "github_manifests_imported": int(stats.get("github_manifests_imported", 0)),
            "github_manifests_mapped": int(stats.get("github_manifests_mapped", 0)),
            "github_manifests_unmapped": int(stats.get("github_manifests_unmapped", 0)),
            "apps_with_manifests": int(stats.get("apps_with_manifests", 0)),
        }
    )
    write_json(IMPORT_STATS_FILE, stats)


def scan_single_appid(appid: str) -> dict[str, Any] | None:
    providers = [
        scan_with_steam_pics_api,
        scan_with_steamkit_python,
        scan_with_steamcmd_binary,
        scan_with_mock_file,
    ]
    for provider in providers:
        result = provider(appid)
        if result is not None:
            return result
    return None


def save_snapshot(snapshot: dict[str, Any]) -> None:
    appid = str(snapshot["appid"])
    stamp = now_file_stamp()
    snapshot_dir = APPINFO_SNAPSHOTS_DIR / appid
    write_json(snapshot_dir / f"{stamp}.json", snapshot)


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan Steam appinfo/PICS and persist snapshots.")
    parser.add_argument("--appid", default="", help="Single appid or comma-separated appids.")
    parser.add_argument("--limit", type=int, default=DEFAULT_SCAN_LIMIT, help="How many appids to take from search-index.")
    args = parser.parse_args()

    manual_input = parse_workflow_input_appids(args.appid)
    workflow_input = parse_workflow_input_appids(os.environ.get("INPUT_APPID", ""))
    direct_targets = unique_preserve_order(manual_input + workflow_input)
    if direct_targets:
        target_appids = direct_targets
    else:
        target_appids = load_target_appids([], max(args.limit, 0))

    if not target_appids:
        log("No appids to scan.")
        update_import_stats(0)
        return 0

    scanned = 0
    for appid in target_appids:
        snapshot = scan_single_appid(appid)
        if snapshot is None:
            continue
        save_snapshot(snapshot)
        upsert_manifest_history(snapshot)
        scanned += 1
        log(f"Scanned appid={appid} source={snapshot.get('source')} depots={len(snapshot.get('depots', []))}")

    update_import_stats(scanned)
    log(f"Done. apps_scanned={scanned}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
