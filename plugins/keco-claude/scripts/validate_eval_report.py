#!/usr/bin/env python3
"""Validate completion evidence before a v2 report can claim success."""
import argparse
import json
import pathlib
import sys


REQUIRED = ("version", "runId", "sliceId", "status", "snapshotHash", "evaluations", "changedFiles", "manualRequirements")
STATUSES = {"passed", "partial", "failed", "blocked_before_write"}
EVALUATION_STATUSES = {"passed", "failed", "manual_required", "blocked"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=pathlib.Path)
    args = parser.parse_args()
    try:
        report = json.loads(args.path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"invalid report: {exc}", file=sys.stderr)
        return 2
    if not isinstance(report, dict):
        print("report must be a JSON object", file=sys.stderr)
        return 1
    missing = [key for key in REQUIRED if key not in report]
    if missing:
        print("missing: " + ", ".join(missing), file=sys.stderr)
        return 1
    if report["version"] != 2 or report["status"] not in STATUSES:
        print("invalid version/status", file=sys.stderr)
        return 1
    for key in ("changedFiles", "manualRequirements"):
        if not isinstance(report[key], list):
            print(f"{key} must be an array", file=sys.stderr)
            return 1
    evaluations = report["evaluations"]
    if not isinstance(evaluations, list) or not evaluations:
        print("evaluations must be a non-empty array", file=sys.stderr)
        return 1
    for evaluation in evaluations:
        if not isinstance(evaluation, dict) or not {"evalId", "status", "evidence"}.issubset(evaluation):
            print("evaluation lacks evalId/status/evidence", file=sys.stderr)
            return 1
        if evaluation["status"] not in EVALUATION_STATUSES:
            print(f"invalid evaluation status: {evaluation['status']!r}", file=sys.stderr)
            return 1
    snapshot_hash = report["snapshotHash"]
    if report["status"] == "passed":
        # A pass needs the fresh snapshot hash the running project reported plus
        # direct evidence for every evaluation (SKILL.md gate 11).
        if not isinstance(snapshot_hash, str) or not snapshot_hash.startswith("sha256:"):
            print("passed report needs a sha256: snapshot hash", file=sys.stderr)
            return 1
        if any(item["status"] != "passed" for item in evaluations):
            print("passed report needs all passed evaluations", file=sys.stderr)
            return 1
        if any(not item["evidence"] for item in evaluations):
            print("passed report needs evidence for every evaluation", file=sys.stderr)
            return 1
    elif snapshot_hash is not None and not isinstance(snapshot_hash, str):
        print("snapshotHash must be null or a string", file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, "status": report["status"], "evaluationCount": len(evaluations)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
