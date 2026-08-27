#!/usr/bin/env python3
"""Atomically materialize and verify an export_slice_mirrors manifest."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any


HASH_LENGTH = 71


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True)


def sha256(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


def fail(message: str) -> None:
    raise ValueError(message)


def valid_hash(value: Any) -> bool:
    return isinstance(value, str) and len(value) == HASH_LENGTH and value.startswith("sha256:") and all(character in "0123456789abcdef" for character in value[7:])


def valid_path(value: Any) -> bool:
    return isinstance(value, str) and bool(value) and not value.startswith(("/", "\\")) and "\\" not in value and ".." not in value.split("/")


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"invalid JSON at {path}: {exc}")


def resolve_root(path: Path) -> Path:
    if not path.is_dir() or path.is_symlink():
        fail("repository root must be an existing non-symlink directory")
    return path.resolve(strict=True)


def validate_manifest(value: Any) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    required = {"schemaVersion", "canonicalizationVersion", "runId", "stateToken", "currentSequence", "files", "manifestHash"}
    if not isinstance(value, dict) or set(value) != required:
        fail("manifest must be an export_slice_mirrors response")
    if value.get("schemaVersion") != 1 or value.get("canonicalizationVersion") != 1 or not isinstance(value.get("runId"), str) or not value["runId"] or not isinstance(value.get("stateToken"), str) or not value["stateToken"] or not isinstance(value.get("currentSequence"), int) or isinstance(value["currentSequence"], bool) or value["currentSequence"] < 0:
        fail("manifest identity is invalid")
    files = value.get("files")
    if not isinstance(files, list) or not files:
        fail("manifest files must be a non-empty array")
    if not valid_hash(value.get("manifestHash")) or value["manifestHash"] != sha256(canonical_json(files).encode("utf-8")):
        fail("manifest digest does not match its export entries")
    paths: set[str] = set()
    required_file = {"kind", "repositoryPath", "documentId", "epoch", "revision", "byteCount", "sha256", "content"}
    for item in files:
        if not isinstance(item, dict) or set(item) != required_file or not isinstance(item.get("kind"), str) or not item["kind"] or not valid_path(item.get("repositoryPath")) or item["repositoryPath"] in paths or not isinstance(item.get("documentId"), str) or not item["documentId"] or not isinstance(item.get("epoch"), int) or isinstance(item["epoch"], bool) or item["epoch"] < 0 or not isinstance(item.get("revision"), int) or isinstance(item["revision"], bool) or item["revision"] < 0 or not isinstance(item.get("byteCount"), int) or isinstance(item["byteCount"], bool) or item["byteCount"] < 0 or not valid_hash(item.get("sha256")) or not isinstance(item.get("content"), str):
            fail("manifest file entry is invalid")
        content = item["content"].encode("utf-8")
        if len(content) != item["byteCount"] or sha256(content) != item["sha256"]:
            fail("manifest file content does not match its digest")
        paths.add(item["repositoryPath"])
    return value, files


def read_allowed(args: argparse.Namespace) -> set[str]:
    if args.allowed_files is not None:
        value = read_json(args.allowed_files)
        allowed = value.get("allowedFiles") if isinstance(value, dict) else value
    else:
        context = read_json(args.run_context)
        allowed = context.get("allowedFiles") if isinstance(context, dict) else None
    if not isinstance(allowed, list) or not allowed or any(not valid_path(item) for item in allowed):
        fail("allowedFiles must be a non-empty array of repository-relative paths")
    return set(allowed)


def target_path(root: Path, relative: str) -> Path:
    target = root.joinpath(*relative.split("/"))
    try:
        target.relative_to(root)
    except ValueError:
        fail("mirror path escapes repository root")
    current = root
    for part in relative.split("/")[:-1]:
        current = current / part
        if current.exists() and current.is_symlink():
            fail("mirror path contains a symlink")
    if target.exists() and target.is_symlink():
        fail("mirror target is a symlink")
    return target


def atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.parent.is_symlink():
        fail("mirror path contains a symlink")
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def remove_output(path: Path | None) -> None:
    if path is not None and path.exists() and path.is_file() and not path.is_symlink():
        path.unlink()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--repository-root", "--repo-root", dest="repository_root", type=Path, required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--allowed-files", type=Path)
    group.add_argument("--run-context", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output
    try:
        remove_output(output)
        root = resolve_root(args.repository_root)
        manifest, files = validate_manifest(read_json(args.manifest))
        allowed = read_allowed(args)
        written: list[dict[str, Any]] = []
        for item in files:
            relative = item["repositoryPath"]
            if relative not in allowed:
                fail("manifest path is not present in allowedFiles")
            target = target_path(root, relative)
            content = item["content"].encode("utf-8")
            atomic_write(target, content)
            actual = target.read_bytes()
            if len(actual) != item["byteCount"] or sha256(actual) != item["sha256"]:
                fail("mirror read-back does not match export manifest")
            written.append({"repositoryPath": relative, "byteCount": len(actual), "sha256": sha256(actual)})
        verification = {
            "schemaVersion": 1,
            "artifactType": "MirrorVerification",
            "runId": manifest["runId"],
            "stateToken": manifest["stateToken"],
            "manifestHash": manifest["manifestHash"],
            "files": written,
        }
        atomic_write(output, (canonical_json(verification) + "\n").encode("utf-8"))
        print(json.dumps({"ok": True, "manifestHash": manifest["manifestHash"], "fileCount": len(written)}, sort_keys=True))
        return 0
    except (OSError, ValueError) as exc:
        try:
            remove_output(output)
        except OSError:
            pass
        print(f"mirror materialization failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
