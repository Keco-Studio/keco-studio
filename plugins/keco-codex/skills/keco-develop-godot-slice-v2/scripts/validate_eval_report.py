#!/usr/bin/env python3
"""Validate completion evidence before a v2 report can claim success."""
import argparse
import json
import pathlib
import sys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=pathlib.Path)
    args = parser.parse_args()
    try:
        report = json.loads(args.path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"invalid report: {exc}", file=sys.stderr)
        return 2
    required = ("version", "runId", "sliceId", "status", "snapshotHash", "evaluations", "changedFiles", "manualRequirements")
    missing = [key for key in required if key not in report]
    if missing:
        print("missing: " + ", ".join(missing), file=sys.stderr)
        return 1
    if report["version"] != 2 or report["status"] not in {"passed", "partial", "failed", "blocked_before_write"}:
        print("invalid version/status", file=sys.stderr)
        return 1
    for evaluation in report["evaluations"]:
        if not {"evalId", "status", "evidence"}.issubset(evaluation):
            print("evaluation lacks evalId/status/evidence", file=sys.stderr)
            return 1
    if report["status"] == "passed":
        if not report["snapshotHash"].startswith("sha256:") or any(item["status"] != "passed" for item in report["evaluations"]):
            print("passed report needs a snapshot hash and all passed evaluations", file=sys.stderr)
            return 1
    print("evaluation report valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
