#!/usr/bin/env python3
"""Crash-safely materialize and verify an export_slice_mirrors manifest."""
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
JOURNAL_NAME = ".keco-slice-mirror-journal.json"
AUXILIARY_PREFIX = ".keco-slice-mirror-"
V2_KINDS = {"roadmap", "spec", "plan"}


class RecoveryRequired(Exception):
    def __init__(self, journal: Path, affected_paths: list[str], detail: str):
        super().__init__(detail)
        self.journal = journal
        self.affected_paths = affected_paths


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True)


def sha256(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


def fail(message: str) -> None:
    raise ValueError(message)


def valid_hash(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == HASH_LENGTH
        and value.startswith("sha256:")
        and all(character in "0123456789abcdef" for character in value[7:])
    )


def valid_integer(value: Any, minimum: int = 0) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= minimum


def valid_path(value: Any) -> bool:
    return (
        isinstance(value, str)
        and bool(value)
        and not value.startswith(("/", "\\"))
        and "\\" not in value
        and "" not in value.split("/")
        and "." not in value.split("/")
        and ".." not in value.split("/")
    )


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"invalid JSON at {path}: {exc}")


def resolve_root(path: Path) -> Path:
    if not path.is_dir() or path.is_symlink():
        fail("repository root must be an existing non-symlink directory")
    return path.resolve(strict=True)


def canonical_v2_path(kind: str, relative: str) -> bool:
    if kind == "roadmap":
        return relative == "docs/superpowers/roadmap.md"
    if kind == "spec":
        return relative.startswith("docs/superpowers/specs/") and relative.endswith("-design.md")
    if kind == "plan":
        return relative.startswith("docs/superpowers/plans/") and relative.endswith(".md")
    return False


def validate_manifest(value: Any) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    common = {
        "schemaVersion", "canonicalizationVersion", "runId", "stateToken",
        "currentSequence", "files", "manifestHash",
    }
    if not isinstance(value, dict) or value.get("ok", True) is not True:
        fail("manifest must be a successful export_slice_mirrors response")
    required = common | {"contractVersion", "preparedSequence"}
    if set(value) - {"ok"} != required:
        fail("version 2 mirror manifest fields are invalid")
    if value.get("schemaVersion") != 2 or value.get("contractVersion") != 2:
        fail("version 2 mirror manifest identity is invalid")
    if not valid_integer(value.get("preparedSequence"), 1):
        fail("version 2 prepared sequence is invalid")
    if not valid_integer(value.get("currentSequence"), 1) or value["preparedSequence"] > value["currentSequence"]:
        fail("version 2 export sequence is invalid")
    if (
        value.get("canonicalizationVersion") != 1
        or not isinstance(value.get("runId"), str) or not value["runId"]
        or not isinstance(value.get("stateToken"), str) or not value["stateToken"]
    ):
        fail("manifest identity is invalid")
    files = value.get("files")
    if not isinstance(files, list) or not files:
        fail("manifest files must be a non-empty array")
    if len(files) != 3:
        fail("version 2 mirror manifest must contain exactly three files")
    if not valid_hash(value.get("manifestHash")) or value["manifestHash"] != sha256(canonical_json(files).encode("utf-8")):
        fail("manifest digest does not match its export entries")

    paths: set[str] = set()
    kinds: set[str] = set()
    fields = {"kind", "repositoryPath", "documentId", "folderId", "epoch", "revision", "byteCount", "sha256", "content"}
    for item in files:
        if not isinstance(item, dict) or set(item) != fields:
            fail("manifest file entry fields are invalid")
        kind = item.get("kind")
        relative = item.get("repositoryPath")
        if (
            not isinstance(kind, str) or not kind
            or not valid_path(relative) or relative in paths or kind in kinds
            or not isinstance(item.get("documentId"), str) or not item["documentId"]
            or not isinstance(item.get("folderId"), str) or not item["folderId"]
            or not valid_integer(item.get("epoch"))
            or not valid_integer(item.get("revision"))
            or not valid_integer(item.get("byteCount"))
            or not valid_hash(item.get("sha256"))
            or not isinstance(item.get("content"), str)
        ):
            fail("manifest file entry is invalid")
        if kind not in V2_KINDS or not canonical_v2_path(kind, relative):
            fail("version 2 mirror kind or repository path is invalid")
        content = item["content"].encode("utf-8")
        if len(content) != item["byteCount"] or sha256(content) != item["sha256"]:
            fail("manifest file content does not match its digest")
        paths.add(relative)
        kinds.add(kind)
    if kinds != V2_KINDS:
        fail("version 2 mirror manifest must contain roadmap, spec, and plan")
    return value, files


def read_allowed(args: argparse.Namespace) -> set[str]:
    if args.allowed_files is not None:
        value = read_json(args.allowed_files)
        allowed = value.get("allowedFiles") if isinstance(value, dict) else value
    else:
        context = read_json(args.run_context)
        allowed = context.get("allowedFiles") if isinstance(context, dict) else None
    if (
        not isinstance(allowed, list) or not allowed
        or any(not valid_path(item) for item in allowed)
        or len(set(allowed)) != len(allowed)
    ):
        fail("allowedFiles must be a non-empty unique array of repository-relative paths")
    return set(allowed)


def target_path(root: Path, relative: str) -> Path:
    target = root.joinpath(*relative.split("/"))
    current = root
    for part in relative.split("/")[:-1]:
        current = current / part
        if current.is_symlink():
            fail("mirror path contains a symlink")
        if current.exists() and not current.is_dir():
            fail("mirror path parent is not a directory")
    if target.is_symlink():
        fail("mirror target is a symlink")
    if target.exists() and not target.is_file():
        fail("mirror target must be a regular file")
    return target


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_temp(parent: Path, content: bytes, suffix: str) -> Path:
    descriptor, temporary = tempfile.mkstemp(prefix=AUXILIARY_PREFIX, suffix=suffix, dir=parent)
    path = Path(temporary)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        return path
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def atomic_write(path: Path, content: bytes) -> None:
    if path.is_symlink():
        fail(f"refusing to replace symlink output {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.parent.is_symlink():
        fail("output path contains a symlink")
    temporary = write_temp(path.parent, content, ".tmp")
    try:
        os.replace(temporary, path)
        fsync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def remove_output(path: Path) -> None:
    if path.is_symlink():
        fail("verification output must not be a symlink")
    if path.exists():
        if not path.is_file():
            fail("verification output must be a regular file")
        path.unlink()


def relative_auxiliary(root: Path, path: Path) -> str:
    relative = path.relative_to(root).as_posix()
    if not valid_path(relative) or not path.name.startswith(AUXILIARY_PREFIX):
        fail("mirror auxiliary path is invalid")
    return relative


def remove_created_directories(root: Path, values: list[str]) -> None:
    for relative in sorted(values, key=lambda value: value.count("/"), reverse=True):
        path = root.joinpath(*relative.split("/"))
        try:
            path.rmdir()
        except (FileNotFoundError, OSError):
            pass


def cleanup_entry_files(root: Path, entries: list[dict[str, Any]]) -> None:
    for entry in entries:
        for key in ("stagePath", "backupPath"):
            relative = entry.get(key)
            if isinstance(relative, str) and valid_path(relative):
                path = root.joinpath(*relative.split("/"))
                if path.name.startswith(AUXILIARY_PREFIX) and not path.is_symlink():
                    path.unlink(missing_ok=True)


def validate_journal(root: Path, value: Any) -> tuple[list[dict[str, Any]], list[str]]:
    if not isinstance(value, dict) or set(value) != {"schemaVersion", "entries", "createdDirectories"} or value.get("schemaVersion") != 1:
        fail("mirror recovery journal is invalid")
    entries = value.get("entries")
    created = value.get("createdDirectories")
    if not isinstance(entries, list) or not entries or not isinstance(created, list):
        fail("mirror recovery journal is invalid")
    paths: set[str] = set()
    for entry in entries:
        required = {"repositoryPath", "existed", "priorByteCount", "priorSha256", "stagePath", "backupPath"}
        if not isinstance(entry, dict) or set(entry) != required:
            fail("mirror recovery journal entry is invalid")
        relative = entry.get("repositoryPath")
        if not valid_path(relative) or relative in paths or not isinstance(entry.get("existed"), bool):
            fail("mirror recovery journal target is invalid")
        target = target_path(root, relative)
        for key in ("stagePath", "backupPath"):
            auxiliary = entry.get(key)
            if auxiliary is not None:
                if not valid_path(auxiliary):
                    fail("mirror recovery journal auxiliary path is invalid")
                auxiliary_path = root.joinpath(*auxiliary.split("/"))
                if not auxiliary_path.name.startswith(AUXILIARY_PREFIX) or auxiliary_path.parent != target.parent:
                    fail("mirror recovery journal auxiliary path is invalid")
        if entry["existed"]:
            if not valid_integer(entry.get("priorByteCount")) or not valid_hash(entry.get("priorSha256")) or entry.get("backupPath") is None:
                fail("mirror recovery journal prior identity is invalid")
        elif entry.get("priorByteCount") is not None or entry.get("priorSha256") is not None or entry.get("backupPath") is not None:
            fail("mirror recovery journal absent target identity is invalid")
        paths.add(relative)
    if any(not valid_path(item) for item in created):
        fail("mirror recovery journal directory list is invalid")
    return entries, created


def recover_journal(root: Path, journal: Path) -> None:
    try:
        entries, created = validate_journal(root, read_json(journal))
        if os.environ.get("KECO_MIRROR_TEST_RESTORE_FAULT") == "1":
            raise OSError("injected mirror restoration failure")
        for entry in entries:
            target = target_path(root, entry["repositoryPath"])
            if entry["existed"]:
                backup = root.joinpath(*entry["backupPath"].split("/"))
                if not backup.is_file() or backup.is_symlink():
                    fail("mirror recovery backup is missing or invalid")
                prior = backup.read_bytes()
                if len(prior) != entry["priorByteCount"] or sha256(prior) != entry["priorSha256"]:
                    fail("mirror recovery backup digest is invalid")
                atomic_write(target, prior)
            elif target.exists() or target.is_symlink():
                if target.is_symlink() or not target.is_file():
                    fail("mirror recovery target type changed")
                target.unlink()
                fsync_directory(target.parent)
        for entry in entries:
            target = target_path(root, entry["repositoryPath"])
            if entry["existed"]:
                actual = target.read_bytes()
                if len(actual) != entry["priorByteCount"] or sha256(actual) != entry["priorSha256"]:
                    fail("mirror recovery read-back does not match prior identity")
            elif target.exists() or target.is_symlink():
                fail("mirror recovery could not restore an absent target")
        cleanup_entry_files(root, entries)
        journal.unlink()
        fsync_directory(root)
        remove_created_directories(root, created)
    except (OSError, ValueError) as exc:
        affected = []
        try:
            raw = read_json(journal)
            if isinstance(raw, dict) and isinstance(raw.get("entries"), list):
                affected = [
                    entry.get("repositoryPath") for entry in raw["entries"]
                    if isinstance(entry, dict) and valid_path(entry.get("repositoryPath"))
                ]
        except ValueError:
            pass
        raise RecoveryRequired(journal, affected, str(exc)) from exc


def ensure_parents(root: Path, targets: list[Path]) -> list[str]:
    created: list[str] = []
    for target in targets:
        missing: list[Path] = []
        current = target.parent
        while current != root and not current.exists():
            missing.append(current)
            current = current.parent
        for directory in reversed(missing):
            directory.mkdir()
            created.append(directory.relative_to(root).as_posix())
            fsync_directory(directory.parent)
    return created


def materialize(root: Path, journal: Path, files: list[dict[str, Any]], allowed: set[str]) -> list[dict[str, Any]]:
    plans: list[tuple[dict[str, Any], Path, bytes, bytes | None]] = []
    for item in files:
        relative = item["repositoryPath"]
        if relative not in allowed:
            fail("manifest path is not present in allowedFiles")
        target = target_path(root, relative)
        prior = target.read_bytes() if target.exists() else None
        plans.append((item, target, item["content"].encode("utf-8"), prior))
    if os.environ.get("KECO_MIRROR_TEST_FAULT") == "before_staging":
        fail("injected failure before staging")

    entries: list[dict[str, Any]] = []
    created = ensure_parents(root, [target for _, target, _, _ in plans])
    try:
        for item, target, content, prior in plans:
            stage = write_temp(target.parent, content, ".stage")
            if stage.read_bytes() != content:
                fail("staged mirror bytes do not match export manifest")
            backup = write_temp(target.parent, prior, ".backup") if prior is not None else None
            entries.append({
                "repositoryPath": item["repositoryPath"],
                "existed": prior is not None,
                "priorByteCount": len(prior) if prior is not None else None,
                "priorSha256": sha256(prior) if prior is not None else None,
                "stagePath": relative_auxiliary(root, stage),
                "backupPath": relative_auxiliary(root, backup) if backup is not None else None,
            })
        payload = {"schemaVersion": 1, "entries": entries, "createdDirectories": created}
        atomic_write(journal, (canonical_json(payload) + "\n").encode("utf-8"))
        if os.environ.get("KECO_MIRROR_TEST_FAULT") == "after_journal_fsync":
            sys.stderr.flush()
            os._exit(86)
        for index, ((_, target, _, _), entry) in enumerate(zip(plans, entries)):
            stage = root.joinpath(*entry["stagePath"].split("/"))
            os.replace(stage, target)
            fsync_directory(target.parent)
            if index == 0 and os.environ.get("KECO_MIRROR_TEST_FAULT") == "after_first_replacement":
                fail("injected failure after first replacement")
        written: list[dict[str, Any]] = []
        for index, (item, target, _, _) in enumerate(plans):
            if index == 0 and os.environ.get("KECO_MIRROR_TEST_FAULT") == "during_readback":
                fail("injected failure during read-back")
            actual = target.read_bytes()
            if len(actual) != item["byteCount"] or sha256(actual) != item["sha256"]:
                fail("mirror read-back does not match export manifest")
            written.append({"repositoryPath": item["repositoryPath"], "byteCount": len(actual), "sha256": sha256(actual)})
        cleanup_entry_files(root, entries)
        journal.unlink()
        fsync_directory(root)
        return written
    except BaseException:
        if journal.exists():
            recover_journal(root, journal)
        else:
            cleanup_entry_files(root, entries)
            remove_created_directories(root, created)
        raise


def partial_result(exc: RecoveryRequired) -> int:
    print(canonical_json({
        "ok": False,
        "status": "partial",
        "reasonCode": "SLICE_MIRROR_RECOVERY_REQUIRED",
        "journalPath": str(exc.journal),
        "affectedPaths": exc.affected_paths,
        "detail": str(exc),
    }))
    return 2


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
        root = resolve_root(args.repository_root)
        journal = root / JOURNAL_NAME
        if journal.is_symlink():
            fail("mirror recovery journal must not be a symlink")
        if journal.exists():
            recover_journal(root, journal)
        remove_output(output)
        manifest, files = validate_manifest(read_json(args.manifest))
        allowed = read_allowed(args)
        written = materialize(root, journal, files, allowed)
        verification = {
            "schemaVersion": manifest["schemaVersion"],
            "artifactType": "MirrorVerification",
            "runId": manifest["runId"],
            "stateToken": manifest["stateToken"],
            "manifestHash": manifest["manifestHash"],
            "files": written,
        }
        verification.update({"contractVersion": 2, "preparedSequence": manifest["preparedSequence"]})
        atomic_write(output, (canonical_json(verification) + "\n").encode("utf-8"))
        print(canonical_json({"ok": True, "manifestHash": manifest["manifestHash"], "fileCount": len(written)}))
        return 0
    except RecoveryRequired as exc:
        try:
            remove_output(output)
        except (OSError, ValueError):
            pass
        return partial_result(exc)
    except (OSError, ValueError) as exc:
        try:
            remove_output(output)
        except (OSError, ValueError):
            pass
        print(f"mirror materialization failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
