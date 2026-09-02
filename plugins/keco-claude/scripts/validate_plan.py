#!/usr/bin/env python3
"""Validate a task plan's reviewable shape and reject placeholders."""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import sys


# Matched as whole words so ordinary paths and prose (for example a file named
# `todo_list.gd`) are not mistaken for an unfinished plan.
PLACEHOLDERS = ("tbd", "todo", "implement later", "fill in details", "add appropriate")
PLACEHOLDER_RE = re.compile(r"(?<![a-z0-9_-])(?:" + "|".join(re.escape(item) for item in PLACEHOLDERS) + r")(?![a-z0-9_-])")
REQUIRED = ("id", "files", "dependsOn", "servesEvaluations", "red", "green", "review")
FORBIDDEN_RUNTIME_KEYS = {
    "blockedAt",
    "changedFiles",
    "checkpoint",
    "commandOutput",
    "currentTask",
    "evidence",
    "readBack",
    "resumeFrom",
    "retryCount",
    "runId",
    "runtimeLogs",
    "status",
    "writeToken",
}
# `required`/`true` and `optional`/`false` are both accepted so a plan authored
# straight from references/orchestration-contract.md validates as written.
REVIEW_REQUIRED = (True, "required")
REVIEW_OPTIONAL = (False, "optional")


def review_state(value: object) -> bool | None:
    if value in REVIEW_REQUIRED:
        return True
    if value in REVIEW_OPTIONAL:
        return False
    return None


def validate_gdd_binding(plan: dict, inventory_path: pathlib.Path | None) -> str | None:
    if plan.get("coverageMode") != "gdd":
        return "GDD coverage mode is required for this plan"
    ids = plan.get("gddRequirementIds")
    source = plan.get("gddSource")
    if not isinstance(ids, list) or not ids or any(not isinstance(item, str) or not item.strip() for item in ids) or len(ids) != len(set(ids)):
        return "gddRequirementIds must be a non-empty unique string array"
    if not isinstance(source, dict) or source.get("project") != "test8-24" or source.get("document") != "game-gdd" or type(source.get("revision")) is not int or not isinstance(source.get("contentHash"), str) or not isinstance(source.get("inventoryHash"), str):
        return "gddSource must identify test8-24/game-gdd and its inventory hash"
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", source["contentHash"]) or not re.fullmatch(r"sha256:[0-9a-f]{64}", source["inventoryHash"]):
        return "gddSource hashes must use sha256 format"
    if inventory_path is None:
        return "coverage-enabled plan requires --inventory"
    try:
        inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return f"invalid coverage inventory: {exc}"
    if not isinstance(inventory, dict):
        return "invalid coverage inventory: root must be an object"
    validator = pathlib.Path(__file__).with_name("validate_gdd_coverage.py")
    if subprocess.run([sys.executable, str(validator), str(inventory_path)], capture_output=True).returncode != 0:
        return "inventory fails validate_gdd_coverage.py"
    unsigned = dict(inventory)
    actual_hash = unsigned.pop("inventoryHash", None)
    expected_hash = "sha256:" + hashlib.sha256(json.dumps(unsigned, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    if actual_hash != expected_hash or source["inventoryHash"] != expected_hash:
        return "plan gddSource inventoryHash does not match inventory"
    inv_source = inventory.get("source", {})
    if source["revision"] != inv_source.get("revision") or source["contentHash"] != inv_source.get("contentHash"):
        return "plan gddSource does not match inventory source"
    known = {item.get("requirementId") for item in inventory.get("requirements", []) if isinstance(item, dict)}
    if any(item not in known for item in ids):
        return "plan references an unknown GDD requirement"
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=pathlib.Path)
    parser.add_argument("--require-gdd", action="store_true")
    parser.add_argument("--inventory", type=pathlib.Path)
    args = parser.parse_args()
    try:
        plan = json.loads(args.path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"invalid plan: {exc}", file=sys.stderr)
        return 2
    tasks = plan.get("tasks") if isinstance(plan, dict) else None
    if not isinstance(tasks, list) or not tasks:
        print("plan must contain a non-empty tasks array", file=sys.stderr)
        return 1
    if any(not isinstance(task, dict) for task in tasks):
        print("each task must be an object", file=sys.stderr)
        return 1
    if FORBIDDEN_RUNTIME_KEYS.intersection(plan) or any(
        isinstance(task, dict) and FORBIDDEN_RUNTIME_KEYS.intersection(task)
        for task in tasks
    ):
        print("plan contains runtime or evidence state", file=sys.stderr)
        return 1
    if PLACEHOLDER_RE.search(json.dumps(plan, ensure_ascii=False).lower()):
        print("plan contains a placeholder", file=sys.stderr)
        return 1
    if args.require_gdd:
        error = validate_gdd_binding(plan, args.inventory)
        if error:
            print(error, file=sys.stderr)
            return 1
    coverage_ids = plan.get("gddRequirementIds")
    if coverage_ids is not None:
        if not isinstance(coverage_ids, list) or not coverage_ids or any(not isinstance(item, str) or not item.strip() for item in coverage_ids) or len(coverage_ids) != len(set(coverage_ids)):
            print("gddRequirementIds must be a non-empty unique string array", file=sys.stderr)
            return 1
        if any("servesRequirements" not in task or not isinstance(task["servesRequirements"], list) or not task["servesRequirements"] for task in tasks if isinstance(task, dict)):
            print("coverage-enabled tasks must declare servesRequirements", file=sys.stderr)
            return 1
        served = {item for task in tasks for item in task.get("servesRequirements", [])}
        if any(item not in coverage_ids for item in served) or served != set(coverage_ids):
            print("task servesRequirements must match plan gddRequirementIds", file=sys.stderr)
            return 1
    ids: set[str] = set()
    quality_reviews = 0
    for task in tasks:
        if not isinstance(task, dict) or any(key not in task for key in REQUIRED):
            print("each task requires id, files, dependsOn, servesEvaluations, red, green, review", file=sys.stderr)
            return 1
        if not isinstance(task["id"], str) or task["id"] in ids or not task["files"] or not task["servesEvaluations"]:
            print("task IDs must be unique and tasks must name files/evaluations", file=sys.stderr)
            return 1
        ids.add(task["id"])
        if not isinstance(task["dependsOn"], list):
            print(f"dependsOn must be an array: {task['id']}", file=sys.stderr)
            return 1
        for phase in ("red", "green"):
            step = task[phase]
            if not isinstance(step, dict) or not isinstance(step.get("command"), str) or not step["command"].strip():
                print("red/green commands are required", file=sys.stderr)
                return 1
        review = task["review"]
        if not isinstance(review, dict) or {"spec", "quality"} - review.keys():
            print("each task review must declare spec and quality", file=sys.stderr)
            return 1
        spec = review_state(review["spec"])
        quality = review_state(review["quality"])
        if spec is None or quality is None:
            print("review values must be true/false or required/optional", file=sys.stderr)
            return 1
        # Every task carries a spec review; the second quality review is scoped
        # to high-risk work (SKILL.md gate 10, references/review-workflow.md).
        if not spec:
            print(f"spec review is required for every task: {task['id']}", file=sys.stderr)
            return 1
        quality_reviews += int(quality)
    if any(dep not in ids for task in tasks for dep in task["dependsOn"]):
        print("task dependency references an unknown task", file=sys.stderr)
        return 1
    positions = {task["id"]: index for index, task in enumerate(tasks)}
    if any(
        positions[dep] >= positions[task["id"]]
        for task in tasks
        for dep in task["dependsOn"]
    ):
        print("each dependency must appear before dependent task", file=sys.stderr)
        return 1
    if not quality_reviews:
        print("at least one task must carry a quality review", file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, "taskCount": len(tasks), "qualityReviews": quality_reviews}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
