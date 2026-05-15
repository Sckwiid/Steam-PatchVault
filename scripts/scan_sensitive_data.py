#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from typing import Any

from config import DATA_DIR, SENSITIVE_FIELD_NAMES
from utils import read_json


def normalize_key(name: str) -> str:
    return "".join(ch for ch in name.lower() if ch.isalnum() or ch == "_")


def scan_value(value: Any, path: str, findings: list[str]) -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            normalized = normalize_key(str(key))
            if normalized in SENSITIVE_FIELD_NAMES:
                findings.append(f"{path}.{key}" if path else str(key))
            scan_value(nested, f"{path}.{key}" if path else str(key), findings)
        return

    if isinstance(value, list):
        for index, nested in enumerate(value):
            scan_value(nested, f"{path}[{index}]", findings)


def main() -> int:
    findings: list[str] = []
    for json_file in sorted(DATA_DIR.rglob("*.json")):
        payload = read_json(json_file, None)
        if payload is None:
            continue
        before = len(findings)
        scan_value(payload, "", findings)
        if len(findings) > before:
            for index in range(before, len(findings)):
                findings[index] = f"{json_file.relative_to(DATA_DIR)}::{findings[index]}"

    if findings:
        print("[scan_sensitive_data] ERROR: Sensitive fields detected:")
        for finding in findings:
            print(f"  - {finding}")
        return 1

    print("[scan_sensitive_data] OK: no sensitive field names found.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

