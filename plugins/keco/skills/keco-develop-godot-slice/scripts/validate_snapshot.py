#!/usr/bin/env python3
"""Validate hashes, paths, and optional source identity for a Keco snapshot."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any

from export_keco_snapshot import SnapshotError, canonical_bytes, normalize_source, sha256_bytes


def _load_json(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SnapshotError(f"cannot read {label} {path}: {error}") from error


def _resolve_below(root: Path, relative_path: str) -> Path:
    if not isinstance(relative_path, str) or not relative_path:
        raise SnapshotError("manifest table path must be a non-empty string")
    candidate = (root / relative_path).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as error:
        raise SnapshotError(f"manifest path escapes snapshot root: {relative_path}") from error
    return candidate


def validate_snapshot(snapshot_dir: Path, source_input: Path | None = None) -> dict[str, Any]:
    root = snapshot_dir.expanduser().resolve()
    if not root.is_dir():
        raise SnapshotError(f"snapshot directory does not exist: {root}")
    manifest_path = root / "manifest.json"
    manifest = _load_json(manifest_path, "manifest")
    if not isinstance(manifest, dict):
        raise SnapshotError("manifest must be an object")
    schema_version = manifest.get("schemaVersion")
    if not isinstance(schema_version, int) or isinstance(schema_version, bool) or schema_version < 1:
        raise SnapshotError("manifest schemaVersion must be a positive integer")
    tables = manifest.get("tables")
    if not isinstance(tables, list):
        raise SnapshotError("manifest tables must be an array")

    expected_json_paths = {"manifest.json"}
    aggregate_entries: list[dict[str, str]] = []
    table_keys: set[str] = set()
    for index, item in enumerate(tables):
        if not isinstance(item, dict):
            raise SnapshotError(f"manifest table {index} must be an object")
        key = item.get("key")
        if not isinstance(key, str) or key in table_keys:
            raise SnapshotError(f"invalid or duplicate manifest table key: {key}")
        table_keys.add(key)
        relative_path = item.get("path")
        table_path = _resolve_below(root, relative_path)
        expected_json_paths.add(relative_path)
        if not table_path.is_file():
            raise SnapshotError(f"missing generated table file: {relative_path}")
        actual_hash = sha256_bytes(table_path.read_bytes())
        expected_hash = item.get("sha256")
        if actual_hash != expected_hash:
            raise SnapshotError(
                f"hash mismatch for {relative_path}: expected {expected_hash}, got {actual_hash}"
            )
        payload = _load_json(table_path, "generated table")
        if not isinstance(payload, dict) or payload.get("schemaVersion") != schema_version:
            raise SnapshotError(f"schema mismatch in {relative_path}")
        table_metadata = payload.get("table")
        if not isinstance(table_metadata, dict) or table_metadata.get("key") != key:
            raise SnapshotError(f"table identity mismatch in {relative_path}")
        if table_metadata.get("id") != item.get("sourceTableId"):
            raise SnapshotError(f"source table id mismatch in {relative_path}")
        if table_metadata.get("updatedAt") != item.get("sourceUpdatedAt"):
            raise SnapshotError(f"source table revision mismatch in {relative_path}")
        aggregate_entries.append({"path": relative_path, "sha256": actual_hash})

    actual_json_paths = {
        path.relative_to(root).as_posix()
        for path in root.rglob("*.json")
        if path.is_file()
    }
    unexpected = sorted(actual_json_paths - expected_json_paths)
    missing = sorted(expected_json_paths - actual_json_paths)
    if unexpected:
        raise SnapshotError(f"unexpected generated JSON files: {unexpected}")
    if missing:
        raise SnapshotError(f"missing generated JSON files: {missing}")

    aggregate_hash = sha256_bytes(canonical_bytes(sorted(aggregate_entries, key=lambda item: item["path"])))
    if aggregate_hash != manifest.get("aggregateSha256"):
        raise SnapshotError(
            f"aggregate hash mismatch: expected {manifest.get('aggregateSha256')}, got {aggregate_hash}"
        )

    if source_input is not None:
        source = normalize_source(_load_json(source_input, "source input"))
        source_hash = sha256_bytes(canonical_bytes(source))
        if source_hash != manifest.get("sourceInputSha256"):
            raise SnapshotError(
                f"source input hash mismatch: expected {manifest.get('sourceInputSha256')}, got {source_hash}"
            )

    return {
        "aggregateSha256": aggregate_hash,
        "ok": True,
        "schemaVersion": schema_version,
        "tableCount": len(tables),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot-dir", required=True, help="Generated snapshot directory")
    parser.add_argument("--source-input", help="Optional normalized source input to compare")
    args = parser.parse_args(argv)
    try:
        result = validate_snapshot(
            Path(args.snapshot_dir),
            Path(args.source_input) if args.source_input else None,
        )
        print(json.dumps(result, sort_keys=True))
        return 0
    except (SnapshotError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
