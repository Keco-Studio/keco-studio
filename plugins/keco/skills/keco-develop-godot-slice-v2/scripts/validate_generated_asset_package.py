#!/usr/bin/env python3
"""Validate a Keco-backed generated asset package before Godot materialization."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
import sys
from pathlib import Path


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
SAFE_LAYOUTS = {"topdown-15", "topdown-17", "platformer-16", "isometric-atlas"}
ASSET_KINDS = {"character", "animation", "rotation", "tile", "tileset", "texture", "cutout", "image", "edit"}


def png_dimensions(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if len(data) < 24 or data[:8] != PNG_SIGNATURE or data[12:16] != b"IHDR":
        raise ValueError(f"invalid PNG header: {path}")
    width, height = struct.unpack(">II", data[16:24])
    if width <= 0 or height <= 0:
        raise ValueError(f"PNG dimensions must be positive: {path}")
    return width, height


def reject(message: str) -> None:
    raise ValueError(message)


def safe_relative(value: object, field: str) -> Path:
    if not isinstance(value, str) or not value or Path(value).is_absolute() or ".." in Path(value).parts:
        reject(f"{field} must be a safe relative path")
    return Path(value)


def safe_target(value: object) -> str:
    if not isinstance(value, str) or not value.startswith("res://") or ".." in Path(value).parts:
        reject("targetPath must be a safe res:// path")
    return value


def validate_animation(metadata: object, file_width: int, file_height: int, asset_key: str) -> None:
    if not isinstance(metadata, dict):
        reject(f"animation metadata missing for {asset_key}")
    required = ("name", "frameWidth", "frameHeight", "frameCount", "fps", "loop")
    if any(key not in metadata for key in required):
        reject(f"animation metadata incomplete for {asset_key}")
    frame_width = metadata["frameWidth"]
    frame_height = metadata["frameHeight"]
    frame_count = metadata["frameCount"]
    if any(not isinstance(metadata[key], int) or metadata[key] <= 0 for key in ("frameWidth", "frameHeight", "frameCount")):
        reject(f"animation geometry must be positive integers for {asset_key}")
    if not isinstance(metadata["fps"], (int, float)) or metadata["fps"] <= 0:
        reject(f"animation fps must be positive for {asset_key}")
    if file_width != frame_width * frame_count or file_height != frame_height:
        reject(f"animation frame geometry mismatch for {asset_key}")


def validate_tileset(metadata: object, file_width: int, file_height: int, asset_key: str) -> None:
    if not isinstance(metadata, dict) or metadata.get("layout") not in SAFE_LAYOUTS:
        reject(f"unsupported or missing tileset layout for {asset_key}")
    required = ("tileSize", "columns", "rows")
    if any(not isinstance(metadata.get(key), int) or metadata[key] <= 0 for key in required):
        reject(f"tileset dimensions must be positive integers for {asset_key}")
    if file_width != metadata["tileSize"] * metadata["columns"] or file_height != metadata["tileSize"] * metadata["rows"]:
        reject(f"tileset atlas dimensions mismatch for {asset_key}")
    if metadata["layout"] in {"topdown-15", "topdown-17", "platformer-16"} and not metadata.get("terrainMapping"):
        reject(f"terrainMapping is required for {metadata['layout']}: {asset_key}")


def validate(package_path: Path) -> dict:
    try:
        package = json.loads(package_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        reject(f"invalid package: {exc}")
    if package.get("version") != 1 or not isinstance(package.get("assets"), list) or not package["assets"]:
        reject("package requires version 1 and a non-empty assets array")
    project_root = package.get("projectRoot")
    if not isinstance(project_root, str) or not Path(project_root).is_absolute() or not Path(project_root).is_dir():
        reject("projectRoot must be an existing absolute directory")
    root_path = Path(project_root).resolve()
    asset_keys: set[str] = set()
    file_keys: set[str] = set()
    target_paths: set[str] = set()
    file_count = 0
    for asset in package["assets"]:
        if not isinstance(asset, dict):
            reject("each asset must be an object")
        asset_key = asset.get("assetKey")
        if not isinstance(asset_key, str) or not asset_key or asset_key in asset_keys:
            reject(f"duplicate or missing assetKey: {asset_key!r}")
        asset_keys.add(asset_key)
        if asset.get("assetKind") not in ASSET_KINDS:
            reject(f"unsupported assetKind for {asset_key}")
        provider = asset.get("provider")
        if not isinstance(provider, dict) or not provider.get("capability") or "transportTool" not in provider or not provider.get("assetId"):
            reject(f"provider identity incomplete for {asset_key}")
        if asset.get("status") not in {"planned", "ready", "failed", "blocked"}:
            reject(f"invalid status for {asset_key}")
        files = asset.get("files")
        if not isinstance(files, list) or not files:
            reject(f"asset files are required for {asset_key}")
        for file_info in files:
            if not isinstance(file_info, dict):
                reject(f"invalid asset file for {asset_key}")
            file_key = file_info.get("fileKey")
            if not isinstance(file_key, str) or not file_key or file_key in file_keys:
                reject(f"duplicate or missing fileKey: {file_key!r}")
            file_keys.add(file_key)
            relative = safe_relative(file_info.get("sourceFile"), "sourceFile")
            target = safe_target(file_info.get("targetPath"))
            if target in target_paths:
                reject(f"duplicate targetPath: {target}")
            target_paths.add(target)
            source = (root_path / relative).resolve()
            try:
                source.relative_to(root_path)
            except ValueError:
                reject(f"sourceFile escapes projectRoot: {file_key}")
            if not source.is_file():
                reject(f"sourceFile does not exist: {source}")
            if not isinstance(file_info.get("sha256"), str) or not SHA256_RE.fullmatch(file_info["sha256"]):
                reject(f"sha256 must be a 64-character lowercase hex digest: {file_key}")
            if hashlib.sha256(source.read_bytes()).hexdigest() != file_info["sha256"]:
                reject(f"sha256 mismatch: {file_key}")
            width, height = png_dimensions(source)
            if file_info.get("width") != width or file_info.get("height") != height:
                reject(f"declared dimensions mismatch: {file_key}")
            if asset["assetKind"] in {"character", "animation"}:
                validate_animation(file_info.get("animation"), width, height, asset_key)
            if asset["assetKind"] in {"tile", "tileset"}:
                validate_tileset(file_info.get("tileset"), width, height, asset_key)
            file_count += 1
    return {"ok": True, "assetCount": len(asset_keys), "fileCount": file_count}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path)
    args = parser.parse_args()
    try:
        result = validate(args.package)
    except (OSError, ValueError) as exc:
        print(f"asset package invalid: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
