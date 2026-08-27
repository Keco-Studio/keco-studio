#!/usr/bin/env python3
"""Validate the minimum v2 run ledger without contacting any service."""
import argparse
import json
import pathlib
import sys


REQUIRED = ("version", "runId", "mode", "kecoProjectId", "godotProjectPath", "sliceId", "allowedFiles", "iteration")
# Must stay in sync with references/orchestration-contract.md RunContext.mode.
MODES = ("implicit-v2", "explicit-v2")
MAX_ITERATION = 3
HASH_PREFIX = "sha256:"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=pathlib.Path)
    args = parser.parse_args()
    try:
        value = json.loads(args.path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"invalid run context: {exc}", file=sys.stderr)
        return 2
    if not isinstance(value, dict):
        print("run context must be a JSON object", file=sys.stderr)
        return 1
    missing = [key for key in REQUIRED if key not in value]
    if missing:
        print("missing: " + ", ".join(missing), file=sys.stderr)
        return 1
    if value["version"] != 2:
        print("version must be 2", file=sys.stderr)
        return 1
    if value["mode"] not in MODES:
        print("mode must be one of: " + "|".join(MODES), file=sys.stderr)
        return 1
    allowed_files = value["allowedFiles"]
    if not isinstance(allowed_files, list) or not all(
        isinstance(item, str)
        and item
        and not pathlib.PurePosixPath(item).is_absolute()
        and ".." not in pathlib.PurePosixPath(item).parts
        for item in allowed_files
    ):
        print("allowedFiles must contain relative repository paths without parent traversal", file=sys.stderr)
        return 1
    iteration = value["iteration"]
    if not isinstance(iteration, int) or isinstance(iteration, bool) or not 0 <= iteration <= MAX_ITERATION:
        print(f"iteration must be an integer from 0 through {MAX_ITERATION}", file=sys.stderr)
        return 1
    # The write lease is only valid once planning gates pass; an unresolved
    # decision must keep it null (SKILL.md gate 6).
    if "writeToken" in value and value["writeToken"] is not None and not isinstance(value["writeToken"], str):
        print("writeToken must be null or a string", file=sys.stderr)
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
    # Current lifecycle additions are optional so existing version-2 ledgers
    # remain readable. When present, each is strict enough to reject stale or
    # malformed continuation data without compiling project prose.
    for key in ("planRevision", "deliveryPolicyHash", "mirrorManifestHash"):
        if key in value and (not isinstance(value[key], str) or not value[key].startswith(HASH_PREFIX)):
            print(f"{key} must be a sha256 digest", file=sys.stderr)
            return 1
    if "stateToken" in value and (not isinstance(value["stateToken"], str) or not value["stateToken"].strip()):
        print("stateToken must be a non-empty string", file=sys.stderr)
        return 1
    if "repairCount" in value and (
        not isinstance(value["repairCount"], int)
        or isinstance(value["repairCount"], bool)
        or not 0 <= value["repairCount"] <= MAX_ITERATION
    ):
        print(f"repairCount must be an integer from 0 through {MAX_ITERATION}", file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, "mode": value["mode"], "sliceId": value["sliceId"], "iteration": iteration}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
