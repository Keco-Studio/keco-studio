#!/usr/bin/env python3
"""Validate a non-secret Keco interaction checkpoint offline."""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys


REQUIRED = {
    "version",
    "status",
    "blockedAt",
    "completed",
    "writesPerformed",
    "userAction",
    "resumeFrom",
    "checkpoint",
    "revalidate",
}
STATUSES = {"running", "paused", "resuming", "completed", "blocked_before_write", "partial"}
SECRET_KEYS = {
    "apikey",
    "credential",
    "password",
    "privatekey",
    "secret",
    "token",
    "tokenvalue",
    "writetoken",
}
SECRET_VALUE_RE = re.compile(r"(?:\\b(?:sk|pk)[_-](?:live|test)[_-][A-Za-z0-9-]{6,}|\\bsk-[A-Za-z0-9-]{8,})")


def normalized_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def contains_secret(value: object) -> bool:
    if isinstance(value, dict):
        return any(
            normalized_key(str(key)) in SECRET_KEYS or contains_secret(item)
            for key, item in value.items()
        )
    if isinstance(value, list):
        return any(contains_secret(item) for item in value)
    return isinstance(value, str) and bool(SECRET_VALUE_RE.search(value))


def non_empty_string(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def string_list(value: object) -> bool:
    return isinstance(value, list) and all(non_empty_string(item) for item in value)


def validate(value: object) -> None:
    if not isinstance(value, dict):
        raise ValueError("checkpoint must be a JSON object")
    missing = REQUIRED - value.keys()
    if missing:
        raise ValueError("missing checkpoint fields: " + ", ".join(sorted(missing)))
    if contains_secret(value):
        raise ValueError("checkpoint must not contain a secret or credential")
    if value["version"] != 1 or value["status"] not in STATUSES:
        raise ValueError("checkpoint version or status is invalid")
    for field in ("blockedAt", "userAction", "resumeFrom"):
        if not non_empty_string(value[field]):
            raise ValueError(f"{field} must be a non-empty string")
    for field in ("completed", "writesPerformed", "revalidate"):
        if not string_list(value[field]):
            raise ValueError(f"{field} must be an array of non-empty strings")
    checkpoint = value["checkpoint"]
    if not isinstance(checkpoint, dict):
        raise ValueError("checkpoint must contain stable identifiers")
    for field in ("runId", "planRevision"):
        if not non_empty_string(checkpoint.get(field)):
            raise ValueError(f"checkpoint.{field} must be a non-empty string")
    revisions = checkpoint.get("sourceRevisions")
    if not isinstance(revisions, dict) or any(
        not non_empty_string(str(key)) or not non_empty_string(item)
        for key, item in revisions.items()
    ):
        raise ValueError("checkpoint.sourceRevisions must map stable names to revisions")
    if value["status"] == "blocked_before_write" and value["writesPerformed"]:
        raise ValueError("blocked_before_write requires zero development writes")
    if value["status"] == "paused" and value["writesPerformed"]:
        raise ValueError("a paused run with development writes must be partial")
    if value["status"] == "partial" and not value["writesPerformed"]:
        raise ValueError("partial requires at least one development write")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=pathlib.Path)
    args = parser.parse_args()
    try:
        value = json.loads(args.path.read_text(encoding="utf-8"))
        validate(value)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"checkpoint invalid: {exc}", file=sys.stderr)
        return 1
    print("checkpoint valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
