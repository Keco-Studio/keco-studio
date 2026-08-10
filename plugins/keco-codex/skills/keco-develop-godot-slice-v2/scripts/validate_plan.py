#!/usr/bin/env python3
"""Validate a task plan's reviewable shape and reject placeholders."""
import argparse
import json
import pathlib
import sys


PLACEHOLDERS = ("TBD", "TODO", "implement later", "fill in details", "add appropriate")
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


def main() -> int:
    parser = argparse.ArgumentParser()
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
    text = json.dumps(plan, ensure_ascii=False).lower()
    if any(item.lower() in text for item in PLACEHOLDERS):
        print("plan contains a placeholder", file=sys.stderr)
        return 1
    ids = set()
    for task in tasks:
        if not isinstance(task, dict) or any(key not in task for key in REQUIRED):
            print("each task requires id, files, dependsOn, servesEvaluations, red, green, review", file=sys.stderr)
            return 1
        if task["id"] in ids or not task["files"] or not task["servesEvaluations"]:
            print("task IDs must be unique and tasks must name files/evaluations", file=sys.stderr)
            return 1
        ids.add(task["id"])
        if not isinstance(task["red"].get("command"), str) or not isinstance(task["green"].get("command"), str):
            print("red/green commands are required", file=sys.stderr)
            return 1
        if task["review"] != {"spec": True, "quality": True}:
            print("each task requires spec and quality review", file=sys.stderr)
            return 1
    if any(dep not in ids for task in tasks for dep in task["dependsOn"]):
        print("task dependency references an unknown task", file=sys.stderr)
        return 1
    print(f"plan valid: {len(tasks)} tasks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
