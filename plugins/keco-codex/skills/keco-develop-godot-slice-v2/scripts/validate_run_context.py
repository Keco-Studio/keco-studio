#!/usr/bin/env python3
"""Validate the minimum v2 run ledger without contacting any service."""
import argparse
import json
import pathlib
import sys


REQUIRED = ("version", "runId", "mode", "kecoProjectId", "godotProjectPath", "sliceId", "allowedFiles", "iteration")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=pathlib.Path)
    args = parser.parse_args()
    try:
        value = json.loads(args.path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"invalid run context: {exc}", file=sys.stderr)
        return 2
    missing = [key for key in REQUIRED if key not in value]
    if missing:
        print("missing: " + ", ".join(missing), file=sys.stderr)
        return 1
    if value["version"] != 2 or value["mode"] != "manual-v2":
        print("version/mode must be 2/manual-v2", file=sys.stderr)
        return 1
    if not isinstance(value["allowedFiles"], list) or any(not isinstance(item, str) or pathlib.PurePosixPath(item).is_absolute() or ".." in pathlib.PurePosixPath(item).parts for item in value["allowedFiles"]):
        print("allowedFiles must contain relative repository paths without parent traversal", file=sys.stderr)
        return 1
    if not isinstance(value["iteration"], int) or value["iteration"] < 0 or value["iteration"] > 3:
        print("iteration must be an integer from 0 through 3", file=sys.stderr)
        return 1
    interaction = value.get("interaction")
    if interaction is not None:
        if not isinstance(interaction, dict):
            print("interaction must be a checkpoint object", file=sys.stderr)
            return 1
        checkpoint = interaction.get("checkpoint")
        if not isinstance(checkpoint, dict) or checkpoint.get("runId") != value["runId"]:
            print("interaction checkpoint runId must match RunContext.runId", file=sys.stderr)
            return 1
    print("run context valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
