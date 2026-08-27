#!/usr/bin/env python3
"""Validate deterministic TaskResult and independent TaskReview artifacts."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path
from typing import Any


HASH_RE = re.compile(r"^sha256:[a-f0-9]{64}$")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
SECRET_RE = re.compile(r"(?:authorization\s*:|bearer\s+[a-z0-9._-]+|api[_-]?key|password\s*[:=]|secret\s*[:=])", re.I)
IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$")


def fail(message: str) -> None:
    raise ValueError(message)


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"invalid JSON at {path}: {exc}")


def valid_hash(value: Any, *, nullable: bool = False) -> bool:
    return (nullable and value is None) or (isinstance(value, str) and bool(HASH_RE.fullmatch(value)))


def valid_path(value: Any) -> bool:
    return isinstance(value, str) and bool(value) and not value.startswith(("/", "\\")) and "\\" not in value and ".." not in value.split("/")


def valid_id(value: Any) -> bool:
    return isinstance(value, str) and bool(IDENTIFIER_RE.fullmatch(value))


def valid_uuid(value: Any) -> bool:
    return isinstance(value, str) and bool(UUID_RE.fullmatch(value))


def safe_summary(value: Any) -> bool:
    return isinstance(value, str) and len(value) <= 4000 and not SECRET_RE.search(value)


def timestamp(value: Any) -> dt.datetime:
    if not isinstance(value, str):
        fail("timestamps must be ISO-8601 strings")
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        fail("timestamps must be ISO-8601 strings")
    if parsed.tzinfo is None:
        fail("timestamps must include an offset")
    return parsed


def unwrap(value: Any, event_type: str) -> tuple[str, dict[str, Any]]:
    if not isinstance(value, dict):
        fail(f"{event_type} must be an object")
    if set(value) == {"eventId", "eventType", "payload"}:
        if value.get("eventType") != event_type or not valid_uuid(value.get("eventId")) or not isinstance(value.get("payload"), dict):
            fail(f"{event_type} event envelope is invalid")
        return value["eventId"], value["payload"]
    if set(value) == {"artifactId", "artifactType", "payload"}:
        if value.get("artifactType") != "".join(part.title() for part in event_type.split("_")) or not valid_uuid(value.get("artifactId")) or not isinstance(value.get("payload"), dict):
            fail(f"{event_type} artifact envelope is invalid")
        return value["artifactId"], value["payload"]
    fail(f"{event_type} must use a strict event or artifact envelope")


def validate_run_context(value: Any) -> tuple[str, str]:
    if not isinstance(value, dict) or value.get("version") != 2 or not valid_id(value.get("runId")) or not valid_id(value.get("sliceId")):
        fail("RunContext must provide version 2 runId and sliceId")
    return value["runId"], value["sliceId"]


def validate_plan(value: Any) -> tuple[str, dict[str, dict[str, Any]], set[str]]:
    if not isinstance(value, dict) or value.get("schemaVersion") != 1 or not valid_hash(value.get("planRevision")):
        fail("SlicePlan must provide schemaVersion 1 and planRevision")
    tasks = value.get("tasks")
    allowed = value.get("allowedFiles")
    if not isinstance(tasks, list) or not tasks or not isinstance(allowed, list) or not allowed or any(not valid_path(item) for item in allowed):
        fail("SlicePlan tasks and allowedFiles are invalid")
    indexed: dict[str, dict[str, Any]] = {}
    for task in tasks:
        if not isinstance(task, dict) or not valid_id(task.get("id")) or task["id"] in indexed:
            fail("SlicePlan task IDs must be unique")
        for phase in ("red", "green"):
            command = task.get(phase)
            if not isinstance(command, dict) or set(command) != {"command", "expected"} or not isinstance(command.get("command"), str) or not command["command"].strip() or command.get("expected") not in {"fails", "passes"}:
                fail("SlicePlan red/green commands are invalid")
        indexed[task["id"]] = task
    return value["planRevision"], indexed, set(allowed)


def validate_result(payload: dict[str, Any], *, run_id: str, slice_id: str, plan_revision: str, tasks: dict[str, dict[str, Any]], allowed: set[str]) -> None:
    required = {
        "schemaVersion", "runId", "sliceId", "taskId", "planRevision", "attemptId", "phase", "operation", "startedAt", "endedAt",
        "exitCode", "timedOut", "cancelled", "stdoutSummary", "stdoutHash", "stderrSummary", "stderrHash", "changedFiles",
        "expectedOutcome", "observedOutcome", "status", "concerns", "artifactIds",
    }
    if set(payload) != required or payload.get("schemaVersion") != 1:
        fail("TaskResult contains unsupported or missing keys")
    if payload.get("runId") != run_id or payload.get("sliceId") != slice_id or payload.get("planRevision") != plan_revision or payload.get("taskId") not in tasks or not valid_uuid(payload.get("attemptId")):
        fail("TaskResult run, slice, task, or plan binding is invalid")
    phase = payload.get("phase")
    if phase not in {"red", "green", "implementation", "verification"}:
        fail("TaskResult phase is invalid")
    operation = payload.get("operation")
    if not isinstance(operation, dict) or operation.get("kind") not in {"command", "mcp"}:
        fail("TaskResult operation is invalid")
    if operation["kind"] == "command":
        if set(operation) != {"kind", "command"} or not isinstance(operation.get("command"), str) or not operation["command"].strip() or len(operation["command"]) > 1000:
            fail("TaskResult command operation is invalid")
        if phase in {"red", "green"} and operation["command"] != tasks[payload["taskId"]][phase]["command"]:
            fail("TaskResult command does not match the approved task command")
    elif set(operation) != {"kind", "tools"} or not isinstance(operation.get("tools"), list) or not operation["tools"] or len(operation["tools"]) > 50 or any(not valid_id(tool) for tool in operation["tools"]):
        fail("TaskResult MCP operation is invalid")
    started, ended = timestamp(payload.get("startedAt")), timestamp(payload.get("endedAt"))
    if started > ended:
        fail("TaskResult timestamps are inverted")
    if not isinstance(payload.get("timedOut"), bool) or not isinstance(payload.get("cancelled"), bool):
        fail("TaskResult timeout and cancellation fields must be booleans")
    if payload["exitCode"] is not None and (not isinstance(payload["exitCode"], int) or isinstance(payload["exitCode"], bool)):
        fail("TaskResult exitCode must be an integer or null")
    if not all(safe_summary(payload.get(key)) for key in ("stdoutSummary", "stderrSummary")) or not all(valid_hash(payload.get(key)) for key in ("stdoutHash", "stderrHash")):
        fail("TaskResult output summaries or digests are invalid")
    if not isinstance(payload.get("concerns"), list) or len(payload["concerns"]) > 50 or any(not safe_summary(item) for item in payload["concerns"]):
        fail("TaskResult concerns are invalid or contain secrets")
    if not isinstance(payload.get("artifactIds"), list) or len(payload["artifactIds"]) > 50 or any(not valid_uuid(item) for item in payload["artifactIds"]):
        fail("TaskResult artifact IDs are invalid")
    changed = payload.get("changedFiles")
    if not isinstance(changed, list) or len(changed) > 500:
        fail("TaskResult changedFiles are invalid")
    paths: set[str] = set()
    for item in changed:
        if not isinstance(item, dict) or set(item) != {"path", "beforeHash", "afterHash"} or not valid_path(item.get("path")) or item["path"] not in allowed or not valid_hash(item.get("beforeHash"), nullable=True) or not valid_hash(item.get("afterHash"), nullable=True) or (item["beforeHash"] is None and item["afterHash"] is None) or item["path"] in paths:
            fail("TaskResult changed file hashes are invalid")
        paths.add(item["path"])
    expected = payload.get("expectedOutcome")
    observed = payload.get("observedOutcome")
    status = payload.get("status")
    if expected not in {"fails", "passes", "completed"} or observed not in {"failed", "passed", "completed", "blocked"} or status not in {"completed", "failed", "blocked"}:
        fail("TaskResult outcome is invalid")
    phase_expected = {"red": "fails", "green": "passes", "implementation": "completed", "verification": "completed"}[phase]
    if expected != phase_expected:
        fail("TaskResult expected outcome disagrees with its phase")
    if payload["timedOut"] or payload["cancelled"]:
        if observed != "blocked" or status != "blocked":
            fail("timed out or cancelled TaskResult must be blocked")
    elif phase == "red":
        if observed != "failed" or status != "completed" or payload["exitCode"] in {None, 0}:
            fail("RED TaskResult must record the approved failing outcome")
    elif phase == "green":
        if observed != "passed" or status != "completed" or payload["exitCode"] != 0:
            fail("GREEN TaskResult must record the approved passing outcome")
    elif observed == "completed" and status != "completed":
        fail("completed TaskResult outcome must have completed status")


def validate_review(payload: dict[str, Any], *, result_id: str, result: dict[str, Any], run_id: str, slice_id: str, plan_revision: str) -> None:
    required = {"schemaVersion", "runId", "sliceId", "taskId", "planRevision", "taskResultIds", "reviewedFiles", "reviewerType", "reviewerId", "verdict", "specificationFindings", "qualityFindings", "requiredFollowUp"}
    if set(payload) != required or payload.get("schemaVersion") != 1:
        fail("TaskReview contains unsupported or missing keys")
    if payload.get("runId") != run_id or payload.get("sliceId") != slice_id or payload.get("taskId") != result["taskId"] or payload.get("planRevision") != plan_revision:
        fail("TaskReview run, slice, task, or plan binding is invalid")
    ids = payload.get("taskResultIds")
    if not isinstance(ids, list) or ids != [result_id] or any(not valid_uuid(item) for item in ids):
        fail("TaskReview must bind exactly the reviewed TaskResult")
    if payload.get("reviewerType") not in {"agent", "human"} or not valid_id(payload.get("reviewerId")) or payload.get("verdict") not in {"accepted", "rejected"}:
        fail("TaskReview reviewer or verdict is invalid")
    for key in ("specificationFindings", "qualityFindings", "requiredFollowUp"):
        values = payload.get(key)
        if not isinstance(values, list) or len(values) > 50 or any(not safe_summary(item) for item in values):
            fail("TaskReview findings are invalid or contain secrets")
    reviewed = payload.get("reviewedFiles")
    if not isinstance(reviewed, list) or len(reviewed) > 500:
        fail("TaskReview reviewedFiles are invalid")
    expected = {item["path"]: item["afterHash"] for item in result["changedFiles"] if item["afterHash"] is not None}
    actual: dict[str, str] = {}
    for item in reviewed:
        if not isinstance(item, dict) or set(item) != {"path", "hash"} or not valid_path(item.get("path")) or not valid_hash(item.get("hash")) or item["path"] in actual:
            fail("TaskReview reviewed file digests are invalid")
        actual[item["path"]] = item["hash"]
    if actual != expected:
        fail("TaskReview reviewed different bytes than the TaskResult")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-context", type=Path, required=True)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--task-result", type=Path, required=True)
    parser.add_argument("--task-review", type=Path, required=True)
    args = parser.parse_args()
    try:
        run_id, slice_id = validate_run_context(read_json(args.run_context))
        plan_revision, tasks, allowed = validate_plan(read_json(args.plan))
        result_id, result = unwrap(read_json(args.task_result), "task_result")
        _, review = unwrap(read_json(args.task_review), "task_review")
        validate_result(result, run_id=run_id, slice_id=slice_id, plan_revision=plan_revision, tasks=tasks, allowed=allowed)
        validate_review(review, result_id=result_id, result=result, run_id=run_id, slice_id=slice_id, plan_revision=plan_revision)
        print(json.dumps({"ok": True, "taskId": result["taskId"], "taskResultId": result_id, "reviewVerdict": review["verdict"]}, sort_keys=True))
        return 0
    except ValueError as exc:
        print(f"task evidence invalid: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
