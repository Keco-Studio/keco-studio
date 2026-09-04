#!/usr/bin/env python3
"""Validate a GDD requirement inventory and its Slice/Task/Eval coverage."""
import argparse
import hashlib
import json
import pathlib
import re
import sys


ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
CLASSIFICATIONS = {"normative", "descriptive", "tentative"}
AUTHORIZATIONS = {"gdd", "accepted_patch", "proposal"}
STATUSES = {"planned", "implemented", "evaluated", "deferred", "blocked", "awaiting_user_confirmation", "proposal"}


def fail(message: str) -> int:
    print(message, file=sys.stderr)
    return 1


def string_list(value: object, allow_empty: bool = True) -> list[str] | None:
    if not isinstance(value, list) or (not allow_empty and not value) or any(not isinstance(item, str) or not item.strip() for item in value):
        return None
    if len(value) != len(set(value)):
        return None
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=pathlib.Path)
    args = parser.parse_args()
    try:
        payload = json.loads(args.path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"invalid coverage inventory: {exc}", file=sys.stderr)
        return 2
    if not isinstance(payload, dict) or payload.get("version") != 1:
        return fail("coverage inventory version must be 1")
    source = payload.get("source")
    if not isinstance(source, dict) or not isinstance(source.get("project"), str) or not source["project"].strip() or not isinstance(source.get("document"), str) or not source["document"].strip():
        return fail("coverage source must identify a non-empty project and document")
    if type(source.get("revision")) is not int or source["revision"] < 0 or not re.fullmatch(r"sha256:[0-9a-f]{64}", str(source.get("contentHash", ""))):
        return fail("coverage source needs a revision and sha256 contentHash")
    completeness = payload.get("completeness")
    if not isinstance(completeness, dict) or not isinstance(completeness.get("sourceSnapshot"), str) or not completeness["sourceSnapshot"].strip() or not isinstance(completeness.get("reviewMethod"), str) or not completeness["reviewMethod"].strip() or not isinstance(completeness.get("reviewedSections"), list) or not completeness["reviewedSections"]:
        return fail("coverage inventory needs completeness evidence for the full GDD read-back")
    inventory_hash = payload.get("inventoryHash")
    if not isinstance(inventory_hash, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", inventory_hash):
        return fail("coverage inventory needs a sha256 inventoryHash")
    unsigned = dict(payload)
    unsigned.pop("inventoryHash", None)
    expected_inventory_hash = "sha256:" + hashlib.sha256(json.dumps(unsigned, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    if inventory_hash != expected_inventory_hash:
        return fail("inventoryHash does not match canonical inventory content")

    requirements = payload.get("requirements")
    slices = payload.get("slices")
    tasks = payload.get("tasks")
    evaluations = payload.get("evaluations")
    if not all(isinstance(value, list) for value in (requirements, slices, tasks, evaluations)) or not requirements:
        return fail("coverage inventory requires non-empty requirements and arrays for slices/tasks/evaluations")

    slice_ids: set[str] = set()
    for item in slices:
        if not isinstance(item, dict) or not isinstance(item.get("sliceId"), str) or not ID_RE.fullmatch(item["sliceId"]) or item["sliceId"] in slice_ids:
            return fail("slice IDs must be unique stable IDs")
        slice_ids.add(item["sliceId"])

    task_map: dict[str, dict] = {}
    eval_map: dict[str, dict] = {}
    for rows, target, name, key in ((tasks, task_map, "task", "taskId"), (evaluations, eval_map, "evaluation", "evalId")):
        for row in rows:
            if not isinstance(row, dict) or not isinstance(row.get(key), str) or not ID_RE.fullmatch(row[key]) or row[key] in target:
                return fail(f"{name} IDs must be unique stable IDs")
            if not isinstance(row.get("sliceId"), str) or row["sliceId"] not in slice_ids:
                return fail(f"{name} must reference an existing slice")
            refs = string_list(row.get("requirementIds"), allow_empty=False)
            if refs is None:
                return fail(f"{name} requirementIds must be a unique string array")
            target[row[key]] = row

    req_map: dict[str, dict] = {}
    for req in requirements:
        if not isinstance(req, dict):
            return fail("each requirement must be an object")
        rid = req.get("requirementId")
        if not isinstance(rid, str) or not ID_RE.fullmatch(rid) or rid in req_map:
            return fail("requirement IDs must be unique stable IDs")
        if req.get("classification") not in CLASSIFICATIONS or req.get("authorization") not in AUTHORIZATIONS:
            return fail(f"invalid classification or authorization: {rid}")
        if not isinstance(req.get("sourceLocation"), str) or not req["sourceLocation"].strip() or not isinstance(req.get("sourceQuote"), str) or not req["sourceQuote"].strip():
            return fail(f"requirement needs sourceLocation and sourceQuote: {rid}")
        status = req.get("status")
        if status not in STATUSES:
            return fail(f"invalid requirement status: {rid}")
        lists: dict[str, list[str]] = {}
        for field in ("sliceIds", "taskIds", "evalIds"):
            values = string_list(req.get(field))
            if values is None:
                return fail(f"{field} must be a unique string array: {rid}")
            lists[field] = values
        if req["authorization"] == "proposal":
            if status != "proposal" or any(lists.values()):
                return fail(f"proposal cannot enter formal Slice coverage: {rid}")
        if req["authorization"] == "accepted_patch":
            patch = req.get("patchReference")
            if not isinstance(patch, dict) or not isinstance(patch.get("patchId"), str) or not patch["patchId"].strip() or not isinstance(patch.get("sourceLocation"), str) or not patch["sourceLocation"].strip() or not isinstance(patch.get("sourceQuote"), str) or not patch["sourceQuote"].strip():
                return fail(f"accepted_patch needs patchReference evidence: {rid}")
        if status == "deferred":
            target = req.get("deferredToSlice")
            if not isinstance(target, str) or target not in slice_ids:
                return fail(f"deferred requirement needs an existing deferredToSlice: {rid}")
            if any(lists.values()):
                return fail(f"deferred requirement must not claim implementation mappings: {rid}")
        elif status in {"blocked", "awaiting_user_confirmation"}:
            if not isinstance(req.get("reason"), str) or not req["reason"].strip():
                return fail(f"{status} requirement needs a reason: {rid}")
        elif req["classification"] == "normative" and (not lists["sliceIds"] or not lists["taskIds"] or not lists["evalIds"]):
            return fail(f"normative requirement needs Slice/Task/Eval mapping: {rid}")
        if any(value not in slice_ids for value in lists["sliceIds"]):
            return fail(f"requirement references an unknown slice: {rid}")
        if any(value not in task_map for value in lists["taskIds"]) or any(value not in eval_map for value in lists["evalIds"]):
            return fail(f"requirement references an unknown task or evaluation: {rid}")
        req_map[rid] = req

    for task_id, task in task_map.items():
        if any(ref not in req_map for ref in task["requirementIds"]):
            return fail(f"task references an unknown requirement: {task_id}")
        if any(task_id not in req_map[ref]["taskIds"] for ref in task["requirementIds"]):
            return fail(f"task mapping is not reciprocal: {task_id}")
    for eval_id, evaluation in eval_map.items():
        if any(ref not in req_map for ref in evaluation["requirementIds"]):
            return fail(f"evaluation references an unknown requirement: {eval_id}")
        if any(eval_id not in req_map[ref]["evalIds"] for ref in evaluation["requirementIds"]):
            return fail(f"evaluation mapping is not reciprocal: {eval_id}")

    for rid, req in req_map.items():
        for task_id in req["taskIds"]:
            if rid not in task_map[task_id]["requirementIds"] or task_map[task_id]["sliceId"] not in req["sliceIds"]:
                return fail(f"task mapping is not reciprocal: {rid}")
        for eval_id in req["evalIds"]:
            if rid not in eval_map[eval_id]["requirementIds"] or eval_map[eval_id]["sliceId"] not in req["sliceIds"]:
                return fail(f"evaluation mapping is not reciprocal: {rid}")
    print(json.dumps({"ok": True, "requirementCount": len(req_map), "normativeCount": sum(req["classification"] == "normative" for req in req_map.values())}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
