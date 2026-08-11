#!/usr/bin/env python3
"""Validate a task plan's reviewable shape and reject placeholders."""
import argparse
import json
import pathlib
import re
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=pathlib.Path)
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
    if FORBIDDEN_RUNTIME_KEYS.intersection(plan) or any(
        isinstance(task, dict) and FORBIDDEN_RUNTIME_KEYS.intersection(task)
        for task in tasks
    ):
        print("plan contains runtime or evidence state", file=sys.stderr)
        return 1
    if PLACEHOLDER_RE.search(json.dumps(plan, ensure_ascii=False).lower()):
        print("plan contains a placeholder", file=sys.stderr)
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
    if not quality_reviews:
        print("at least one task must carry a quality review", file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, "taskCount": len(tasks), "qualityReviews": quality_reviews}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
