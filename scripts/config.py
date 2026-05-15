from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = REPO_ROOT / "data"

SEARCH_INDEX_FILE = DATA_DIR / "search-index.json"
PRIORITY_APPIDS_FILE = DATA_DIR / "priority-appids.json"
APP_TO_DEPOTS_INDEX_FILE = DATA_DIR / "app-to-depots-index.json"
DEPOT_TO_APP_INDEX_FILE = DATA_DIR / "depot-to-app-index.json"
COMMUNITY_MANIFEST_INDEX_FILE = DATA_DIR / "community-manifest-index.json"
IMPORT_STATS_FILE = DATA_DIR / "import-stats.json"

MANIFESTS_DIR = DATA_DIR / "manifests"
UNMAPPED_MANIFESTS_DIR = DATA_DIR / "unmapped-manifests"
APPINFO_SNAPSHOTS_DIR = DATA_DIR / "appinfo-snapshots"
MOCK_APPINFO_DIR = DATA_DIR / "mock" / "appinfo"

DEFAULT_SCAN_LIMIT = 200
DEFAULT_PRIORITY_SCAN_LIMIT = 100
DEFAULT_BRANCH = "public"

SENSITIVE_FIELD_NAMES = {
    "depotkey",
    "depotkeys",
    "appaccesstoken",
    "app_access_token",
    "cookie",
    "token",
    "password",
    "secret",
    "steamloginsecure",
    "credentials",
}

