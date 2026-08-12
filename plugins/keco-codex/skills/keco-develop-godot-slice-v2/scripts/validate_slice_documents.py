#!/usr/bin/env python3
"""Validate the dated spec, plan, status, and completion record for one Godot slice."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path


DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
PLAN_TASK_RE = re.compile(r"^- \[[ xX]\]\s+([A-Za-z0-9][A-Za-z0-9_-]*):", re.MULTILINE)
PLAN_TASK_BLOCK_RE = re.compile(
    r"^- \[[ xX]\]\s+([A-Za-z0-9][A-Za-z0-9_-]*):[^\n]*(.*?)(?=^- \[[ xX]\]\s+[A-Za-z0-9][A-Za-z0-9_-]*:|\Z)",
    re.MULTILINE | re.DOTALL,
)
PLAN_DEPENDS_RE = re.compile(r"^\s+- Depends on:\s*(.+?)\s*$", re.MULTILINE)
STATUSES = {"planned", "in_progress", "blocked", "completed", "superseded"}
TASK_STATUSES = {"pending", "in_progress", "blocked", "completed"}


def fail(message: str) -> None:
    raise ValueError(message)


def parse_frontmatter(path: Path, expected_type: str) -> dict[str, str]:
    lines = path.read_text(encoding="utf-8").splitlines()
    if len(lines) < 3 or lines[0].strip() != "---":
        fail(f"{path.name} must start with YAML frontmatter")
    try:
        end = lines.index("---", 1)
    except ValueError:
        fail(f"{path.name} frontmatter is not closed")
    values: dict[str, str] = {}
    for line in lines[1:end]:
        if ":" not in line:
            fail(f"invalid frontmatter line in {path.name}: {line}")
        key, value = line.split(":", 1)
        values[key.strip()] = value.strip().strip('"\'')
    required = {"sliceId", "documentType", "createdDate", "updatedDate", "status", "latest"}
    if not required.issubset(values):
        fail(f"{path.name} frontmatter missing: {sorted(required - values.keys())}")
    if values["documentType"] != expected_type:
        fail(f"{path.name} documentType must be {expected_type}")
    return values


def date_value(value: object, field: str) -> dt.date:
    if not isinstance(value, str) or not DATE_RE.fullmatch(value):
        fail(f"{field} must use YYYY-MM-DD")
    try:
        return dt.date.fromisoformat(value)
    except ValueError:
        fail(f"{field} is not a calendar date: {value}")


def validate(slice_dir: Path) -> dict:
    if not slice_dir.is_dir():
        fail(f"slice directory does not exist: {slice_dir}")
    status_path = slice_dir / "status.json"
    spec_path = slice_dir / "spec.md"
    plan_path = slice_dir / "plan.md"
    for required in (status_path, spec_path, plan_path):
        if not required.is_file():
            fail(f"missing slice document: {required.name}")
    try:
        status = json.loads(status_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"invalid status.json: {exc}")
    required_status = {"version", "sliceId", "createdDate", "updatedDate", "status", "latest", "completed", "supersedes", "tasks"}
    if not required_status.issubset(status):
        fail(f"status.json missing: {sorted(required_status - status.keys())}")
    slice_id = status["sliceId"]
    if not isinstance(slice_id, str) or not slice_id or slice_dir.name != slice_id:
        fail("sliceId must match the folder name")
    if status["version"] != 1 or status["status"] not in STATUSES:
        fail("status.json version or status is invalid")
    created = date_value(status["createdDate"], "createdDate")
    updated = date_value(status["updatedDate"], "updatedDate")
    if updated < created or updated > dt.date.today():
        fail("updatedDate must be between createdDate and today")
    if not isinstance(status["latest"], bool) or not isinstance(status["completed"], bool):
        fail("latest and completed must be booleans")
    if status["status"] == "superseded" and status["latest"]:
        fail("superseded slice cannot be latest")
    if status["completed"] != (status["status"] == "completed"):
        fail("completed must match status == completed")
    if not isinstance(status["supersedes"], list) or any(not isinstance(item, str) or item == slice_id for item in status["supersedes"]):
        fail("supersedes must be a list of other slice IDs")
    if not isinstance(status["tasks"], list) or not status["tasks"]:
        fail("tasks must be a non-empty list")
    plan_text = plan_path.read_text(encoding="utf-8")
    plan_task_ids = PLAN_TASK_RE.findall(plan_text)
    if not plan_task_ids:
        fail("plan.md must contain an ordered task checklist")
    task_ids: set[str] = set()
    for task in status["tasks"]:
        if not isinstance(task, dict) or not isinstance(task.get("id"), str) or not task["id"] or task["id"] in task_ids:
            fail("task IDs must be unique and non-empty")
        if task.get("status") not in TASK_STATUSES:
            fail(f"invalid task status: {task.get('status')}")
        task_ids.add(task["id"])
    status_task_ids = [task["id"] for task in status["tasks"]]
    if status_task_ids != plan_task_ids:
        fail("status task order must match the accepted plan")
    task_statuses = {task["id"]: task["status"] for task in status["tasks"]}
    task_positions = {task_id: index for index, task_id in enumerate(plan_task_ids)}
    task_dependencies: dict[str, list[str]] = {}
    for task_id, body in PLAN_TASK_BLOCK_RE.findall(plan_text):
        depends_match = PLAN_DEPENDS_RE.search(body)
        raw_dependencies = depends_match.group(1).strip() if depends_match else "none"
        task_dependencies[task_id] = (
            []
            if raw_dependencies.lower() == "none"
            else [item.strip() for item in raw_dependencies.split(",") if item.strip()]
        )
    transition = status.get("taskTransition")
    if transition is not None:
        if not isinstance(transition, dict):
            fail("taskTransition must be an object")
        required_transition = {
            "pausedTaskId",
            "reason",
            "temporaryTaskIds",
            "returnToTaskId",
            "discoveredDuring",
            "canInline",
            "planImpact",
        }
        if not required_transition.issubset(transition):
            fail("task transition must identify the paused task, reason, temporary tasks, and return task")
        paused_id = transition["pausedTaskId"]
        temporary_ids = transition["temporaryTaskIds"]
        if task_statuses.get(transition["returnToTaskId"]) == "completed":
            fail("task transition must be cleared after the return task completes")
        if (
            transition["returnToTaskId"] != paused_id
            or paused_id not in task_statuses
            or task_statuses[paused_id] not in {"in_progress", "blocked"}
            or not isinstance(transition["reason"], str)
            or not transition["reason"].strip()
            or not isinstance(temporary_ids, list)
            or not temporary_ids
            or len(set(temporary_ids)) != len(temporary_ids)
            or any(task_id not in task_statuses or task_id == paused_id for task_id in temporary_ids)
        ):
            fail("task transition must identify the paused task, reason, temporary tasks, and return task")
        if transition["canInline"] is not False:
            fail("keep inlineable prerequisite work inside the paused task")
        plan_impact = transition["planImpact"]
        if (
            transition["discoveredDuring"] != "execution"
            or not isinstance(plan_impact, dict)
            or set(plan_impact) != {"scopeChanged", "acceptanceChanged", "allowedFilesChanged"}
            or any(value is not False for value in plan_impact.values())
        ):
            fail("the dependency changes the plan; revise and revalidate the plan")
        if any(task_positions[task_id] <= task_positions[paused_id] for task_id in temporary_ids):
            fail("temporary tasks must appear after the paused task")
        if any(
            task_statuses.get(dependency) != "completed"
            for task_id in temporary_ids
            for dependency in task_dependencies.get(task_id, [])
        ):
            fail("temporary task dependencies must already be completed")
    first_open = next(
        (index for index, task in enumerate(status["tasks"]) if task["status"] != "completed"),
        None,
    )
    completed_after_open = (
        []
        if first_open is None
        else [task["id"] for task in status["tasks"][first_open + 1 :] if task["status"] == "completed"]
    )
    if completed_after_open:
        paused_task = status["tasks"][first_open]
        if transition is None:
            fail("out-of-order task completion requires an explicit task transition")
        if (
            transition.get("pausedTaskId") != paused_task["id"]
            or any(task_id not in transition["temporaryTaskIds"] for task_id in completed_after_open)
        ):
            fail("task transition must identify the paused task, reason, temporary tasks, and return task")
    if status["completed"] and any(task["status"] != "completed" for task in status["tasks"]):
        fail("completed slice must have all tasks completed")
    for path, expected_type in ((spec_path, "spec"), (plan_path, "plan")):
        frontmatter = parse_frontmatter(path, expected_type)
        if frontmatter["sliceId"] != slice_id or frontmatter["createdDate"] != status["createdDate"]:
            fail(f"{path.name} identity metadata is stale relative to status.json")
        if frontmatter["latest"] != str(status["latest"]).lower():
            fail(f"{path.name} latest metadata is stale")
        date_value(frontmatter["createdDate"], f"{path.name}.createdDate")
        date_value(frontmatter["updatedDate"], f"{path.name}.updatedDate")
    report_path = slice_dir / "eval-report.json"
    if status["completed"]:
        if not report_path.is_file():
            fail("completed slice requires eval-report.json")
        try:
            report = json.loads(report_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            fail(f"invalid eval-report.json: {exc}")
        if report.get("sliceId") != slice_id or report.get("status") in {None, "blocked_before_write"}:
            fail("eval-report.json must belong to the completed slice")
    return {"ok": True, "sliceId": slice_id, "status": status["status"], "latest": status["latest"], "completed": status["completed"]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--slice-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = validate(args.slice_dir)
    except (OSError, ValueError) as exc:
        print(f"slice documents invalid: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
