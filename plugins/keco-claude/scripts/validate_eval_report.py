#!/usr/bin/env python3
"""Validate completion evidence before a v2 report can claim success."""
import argparse
import json
import pathlib
import sys


REQUIRED = ("version", "runId", "sliceId", "status", "snapshotHash", "evaluations", "runtimeBatches", "changedFiles", "manualRequirements")
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
    batches = report["runtimeBatches"]
    if not isinstance(batches, list):
        print("runtimeBatches must be an array", file=sys.stderr)
        return 1
    covered: list[str] = []
    expected_sequence = ["run_project", "get_debug_output", "stop_project"]
    for batch in batches:
        if not isinstance(batch, dict) or not {"batchId", "evaluationIds", "runtimeSequence", "splitReason"}.issubset(batch):
            print("runtime batch lacks batchId/evaluationIds/runtimeSequence/splitReason", file=sys.stderr)
            return 1
        if batch["runtimeSequence"] != expected_sequence or not isinstance(batch["evaluationIds"], list) or not batch["evaluationIds"]:
            print("runtime batch must use the bounded Godot sequence and name evaluations", file=sys.stderr)
            return 1
        covered.extend(batch["evaluationIds"])
    evaluation_ids = [item["evalId"] for item in evaluations]
    if len(covered) != len(set(covered)) or any(eval_id not in evaluation_ids for eval_id in covered):
        print("runtime batches must cover every evaluation exactly once", file=sys.stderr)
        return 1
    if report["status"] == "passed" and sorted(covered) != sorted(evaluation_ids):
        print("runtime batches must cover every evaluation exactly once", file=sys.stderr)
        return 1
    if len(batches) > 1 and any(not isinstance(batch["splitReason"], str) or not batch["splitReason"].strip() for batch in batches):
        print("every separated runtime batch requires a splitReason", file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, "status": report["status"], "evaluationCount": len(evaluations)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
