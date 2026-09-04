#!/usr/bin/env python3
"""Validate completion evidence before a v2 report can claim success."""
import argparse
import hashlib
import json
import pathlib
import re
import sys
import subprocess


EVALUATION_STATUSES = {"passed", "failed", "manual_required", "blocked"}


def preflight_validator(name: str) -> pathlib.Path:
    here = pathlib.Path(__file__).resolve()
    for candidate in (
        here.with_name(name),
        here.parents[2] / "keco-godot-slice-preflight" / "scripts" / name,
        here.parents[1] / "skills" / "keco-godot-slice-preflight" / "scripts" / name,
    ):
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"missing preflight validator: {name}")


def validate_gdd_binding(report: dict, inventory_path: pathlib.Path | None) -> str | None:
    if report.get("coverageMode") != "gdd":
        return "GDD coverage mode is required for this report"
    ids = report.get("gddRequirementIds")
    source = report.get("gddSource")
    if not isinstance(ids, list) or not ids or any(not isinstance(item, str) or not item.strip() for item in ids) or len(ids) != len(set(ids)):
        return "gddRequirementIds must be a non-empty unique string array"
    if not isinstance(source, dict) or not isinstance(source.get("project"), str) or not source["project"].strip() or not isinstance(source.get("document"), str) or not source["document"].strip() or type(source.get("revision")) is not int or source["revision"] < 0 or not isinstance(source.get("contentHash"), str) or not isinstance(source.get("inventoryHash"), str):
        return "gddSource must identify a project/document and its inventory hash"
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", source["contentHash"]) or not re.fullmatch(r"sha256:[0-9a-f]{64}", source["inventoryHash"]):
        return "gddSource hashes must use sha256 format"
    if inventory_path is None:
        return "coverage-enabled report requires --inventory"
    try:
        inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return f"invalid coverage inventory: {exc}"
    if not isinstance(inventory, dict):
        return "invalid coverage inventory: root must be an object"
    validator = preflight_validator("validate_gdd_coverage.py")
    if subprocess.run([sys.executable, str(validator), str(inventory_path)], capture_output=True).returncode != 0:
        return "inventory fails validate_gdd_coverage.py"
    unsigned = dict(inventory)
    actual_hash = unsigned.pop("inventoryHash", None)
    expected_hash = "sha256:" + hashlib.sha256(json.dumps(unsigned, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    if actual_hash != expected_hash or source["inventoryHash"] != expected_hash:
        return "report gddSource inventoryHash does not match inventory"
    inv_source = inventory.get("source", {})
    if source["revision"] != inv_source.get("revision") or source["contentHash"] != inv_source.get("contentHash"):
        return "report gddSource does not match inventory source"
    known = {item.get("requirementId") for item in inventory.get("requirements", []) if isinstance(item, dict)}
    if any(item not in known for item in ids):
        return "report references an unknown GDD requirement"
    return None


def derived_status(evaluations: list[dict]) -> str:
    """Compute the only aggregate statuses a current report may claim."""
    statuses = [item["status"] for item in evaluations]
    if any(status == "failed" for status in statuses):
        return "failed"
    if any(status == "blocked" for status in statuses):
        return "blocked_before_write"
    if any(status == "manual_required" for status in statuses):
        return "partial"
    return "passed"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=pathlib.Path)
    parser.add_argument("--require-gdd", action="store_true")
    parser.add_argument("--inventory", type=pathlib.Path)
    args = parser.parse_args()
    try:
        report = json.loads(args.path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"invalid report: {exc}", file=sys.stderr)
        return 2
    if not isinstance(report, dict):
        print("invalid report: root must be an object", file=sys.stderr)
        return 1
    required = ("version", "runId", "sliceId", "status", "snapshotHash", "evaluations", "runtimeBatches", "changedFiles", "manualRequirements")
    missing = [key for key in required if key not in report]
    if missing:
        print("missing: " + ", ".join(missing), file=sys.stderr)
        return 1
    if report.get("version") != 2 or report.get("status") not in {"passed", "partial", "failed", "blocked_before_write"}:
        print("invalid version/status", file=sys.stderr)
        return 1
    if args.require_gdd:
        error = validate_gdd_binding(report, args.inventory)
        if error:
            print(error, file=sys.stderr)
            return 1
    evaluations = report["evaluations"]
    if not isinstance(evaluations, list) or not evaluations:
        print("evaluations must be a non-empty array", file=sys.stderr)
        return 1
    evaluation_ids_seen: set[str] = set()
    for evaluation in evaluations:
        if not isinstance(evaluation, dict) or not {"evalId", "status", "evidence"}.issubset(evaluation):
            print("evaluation lacks evalId/status/evidence", file=sys.stderr)
            return 1
        if not isinstance(evaluation["evalId"], str) or not evaluation["evalId"].strip() or evaluation["evalId"] in evaluation_ids_seen:
            print("evaluation IDs must be unique strings", file=sys.stderr)
            return 1
        evaluation_ids_seen.add(evaluation["evalId"])
        if evaluation["status"] not in EVALUATION_STATUSES:
            print(f"invalid evaluation status: {evaluation['status']!r}", file=sys.stderr)
            return 1
        # Current reports carry computed AssertionResult values. A legacy
        # self-reported pass has no authority unless semantic evidence exists.
        assertions = evaluation.get("assertions")
        if assertions is not None:
            if not isinstance(assertions, list) or not assertions:
                print("current evaluation assertions must be a non-empty array", file=sys.stderr)
                return 1
            if any(not isinstance(item, dict) or item.get("status") not in {"passed", "failed"} for item in assertions):
                print("assertion results must provide passed or failed status", file=sys.stderr)
                return 1
            if args.require_gdd and any(not isinstance(item.get("assertionId"), str) or item.get("expected") is None or item.get("actual") is None for item in assertions):
                print("GDD assertions require assertionId, expected, and actual", file=sys.stderr)
                return 1
            assertion_ids = [item["assertionId"] for item in assertions if isinstance(item, dict) and isinstance(item.get("assertionId"), str)]
            if len(assertion_ids) != len(set(assertion_ids)):
                print("assertion IDs must be unique", file=sys.stderr)
                return 1
            computed = "failed" if any(item["status"] == "failed" for item in assertions) else "passed"
            if evaluation["status"] != computed:
                print("evaluation status disagrees with computed assertion results", file=sys.stderr)
                return 1
        elif evaluation["status"] == "passed":
            evidence = evaluation["evidence"]
            if not isinstance(evidence, list) or not any(isinstance(item, dict) and item.get("actual") is not None for item in evidence):
                print("legacy pass requires semantic evidence, not a self-reported pass", file=sys.stderr)
                return 1
    if report["status"] != derived_status(evaluations):
        print("report status disagrees with computed evaluation status", file=sys.stderr)
        return 1
    coverage_ids = report.get("gddRequirementIds")
    if coverage_ids is not None:
        if not isinstance(coverage_ids, list) or not coverage_ids or any(not isinstance(item, str) or not item.strip() for item in coverage_ids) or len(coverage_ids) != len(set(coverage_ids)):
            print("gddRequirementIds must be a non-empty unique string array", file=sys.stderr)
            return 1
        covered_requirements: set[str] = set()
        for evaluation in evaluations:
            refs = evaluation.get("requirementIds")
            if not isinstance(refs, list) or not refs or any(not isinstance(item, str) or not item.strip() for item in refs):
                print("coverage-enabled evaluations must declare requirementIds", file=sys.stderr)
                return 1
            if any(item not in coverage_ids for item in refs):
                print("evaluation requirementIds must match report gddRequirementIds", file=sys.stderr)
                return 1
            covered_requirements.update(refs)
        if covered_requirements != set(coverage_ids):
            print("evaluation requirementIds must cover report gddRequirementIds", file=sys.stderr)
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
    batch_ids_seen: set[str] = set()
    for batch in batches:
        if not isinstance(batch, dict) or not {"batchId", "evaluationIds", "runtimeSequence", "splitReason"}.issubset(batch):
            print("runtime batch lacks batchId/evaluationIds/runtimeSequence/splitReason", file=sys.stderr)
            return 1
        if batch["runtimeSequence"] != expected_sequence or not isinstance(batch["evaluationIds"], list) or not batch["evaluationIds"]:
            print("runtime batch must use the bounded Godot sequence and name evaluations", file=sys.stderr)
            return 1
        if not isinstance(batch["batchId"], str) or not batch["batchId"].strip() or batch["batchId"] in batch_ids_seen:
            print("runtime batch IDs must be unique strings", file=sys.stderr)
            return 1
        batch_ids_seen.add(batch["batchId"])
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
