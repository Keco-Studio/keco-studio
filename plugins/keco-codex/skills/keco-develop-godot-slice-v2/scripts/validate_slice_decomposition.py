#!/usr/bin/env python3
"""Validate that a multi-Slice bundle contains substantive, distinct plans."""
import argparse
import hashlib
import json
import pathlib
import re
import sys


ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
SOURCE_HASH_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
GENERIC_LINES = (
    "implement the bounded slice from the accepted gdd",
    "the planned slice is ready for implementation",
    "read and validate requirements",
    "implement tasks",
    "run mapped evaluations",
    "independent review of reciprocal gdd coverage",
    "planning-only test",
)
ID_TOKEN_RE = re.compile(r"\b(?:slice|task|eval|gdd)[-_][a-z0-9._-]+\b", re.I)
DATE_RE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
TASK_RE = re.compile(r"^\s*-\s*\[[ xX]\]\s+([^:]+):\s*(.+?)\s*$", re.M)
HEADING_RE = re.compile(r"^\s*#{1,6}\s+(.+?)\s*$", re.M)


def fail(message: str) -> int:
    print(message, file=sys.stderr)
    return 1


def strings(value: object, name: str) -> list[str] | None:
    if not isinstance(value, list) or not value or any(not isinstance(item, str) or not item.strip() for item in value):
        return None
    if len(value) != len(set(value)):
        return None
    if any(not ID_RE.fullmatch(item) for item in value):
        return None
    return value


def read_document(bundle_path: pathlib.Path, item: dict, content_key: str, path_key: str) -> str | None:
    content = item.get(content_key)
    if isinstance(content, str):
        return content
    source_path = item.get(path_key)
    if not isinstance(source_path, str) or not source_path.strip():
        return None
    candidate = pathlib.Path(source_path)
    if not candidate.is_absolute():
        candidate = bundle_path.parent / candidate
    try:
        return candidate.read_text(encoding="utf-8")
    except OSError:
        return None


def sections(markdown: str) -> dict[str, str]:
    matches = list(HEADING_RE.finditer(markdown))
    result: dict[str, str] = {}
    for index, match in enumerate(matches):
        heading = re.sub(r"[^a-z0-9 ]", " ", match.group(1).lower())
        heading = re.sub(r"\s+", " ", heading).strip()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(markdown)
        result[heading] = markdown[match.end():end].strip()
    return result


def substantive_text(value: str) -> str:
    text = re.sub(r"`[^`]+`", " ", value.lower())
    text = ID_TOKEN_RE.sub("<id>", text)
    text = DATE_RE.sub("<date>", text)
    lines = []
    for line in text.splitlines():
        clean = re.sub(r"[*_>#`|\[\]()-]", " ", line)
        clean = re.sub(r"\s+", " ", clean).strip()
        if clean and not any(marker in clean for marker in GENERIC_LINES):
            lines.append(clean)
    return " ".join(lines).strip()


def plan_fingerprint(plan: str) -> str:
    lines = []
    for line in plan.splitlines():
        if any(marker in line.lower() for marker in GENERIC_LINES):
            continue
        lines.append(line)
    return substantive_text("\n".join(lines))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=pathlib.Path, help="decomposition bundle JSON")
    args = parser.parse_args()
    try:
        payload = json.loads(args.path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"invalid decomposition bundle: {exc}", file=sys.stderr)
        return 2
    if not isinstance(payload, dict) or payload.get("version") != 1:
        return fail("decomposition bundle version must be 1")
    source = payload.get("source")
    if (not isinstance(source, dict) or not isinstance(source.get("project"), str) or not source["project"].strip() or
            not isinstance(source.get("document"), str) or not source["document"].strip() or type(source.get("revision")) is not int or
            not SOURCE_HASH_RE.fullmatch(str(source.get("contentHash", "")))):
        return fail("decomposition source must identify a project/document with revision and contentHash")
    items = payload.get("slices")
    if not isinstance(items, list) or not items:
        return fail("decomposition bundle requires a non-empty slices array")

    seen: set[str] = set()
    fingerprints: dict[str, str] = {}
    for item in items:
        if not isinstance(item, dict):
            return fail("each decomposition Slice must be an object")
        slice_id = item.get("sliceId")
        if not isinstance(slice_id, str) or not ID_RE.fullmatch(slice_id) or slice_id in seen:
            return fail("Slice IDs must be unique stable IDs")
        seen.add(slice_id)
        requirement_ids = strings(item.get("requirementIds"), "requirementIds")
        task_ids = strings(item.get("taskIds"), "taskIds")
        eval_ids = strings(item.get("evalIds"), "evalIds")
        if requirement_ids is None or task_ids is None or eval_ids is None:
            return fail(f"{slice_id} needs non-empty unique requirementIds, taskIds, and evalIds")
        spec = read_document(args.path, item, "specContent", "specPath")
        plan = read_document(args.path, item, "planContent", "planPath")
        if spec is None or plan is None:
            return fail(f"{slice_id} must provide readable spec and plan content")

        declared = re.search(r"^\s*sliceId\s*:\s*([^\s]+)\s*$", spec, re.I | re.M)
        if declared and declared.group(1) != slice_id:
            return fail(f"spec sliceId does not match bundle: {slice_id}")
        declared = re.search(r"^\s*sliceId\s*:\s*([^\s]+)\s*$", plan, re.I | re.M)
        if declared and declared.group(1) != slice_id:
            return fail(f"plan sliceId does not match bundle: {slice_id}")
        combined = f"{spec}\n{plan}"
        for identifier in requirement_ids + task_ids + eval_ids:
            if identifier not in combined:
                return fail(f"{slice_id} does not cite mapped identifier: {identifier}")

        parsed = sections(spec)
        required = {
            "objective": "objective",
            "scope": "scope",
            "acceptance": "acceptance",
        }
        for label, heading in required.items():
            value = next((text for name, text in parsed.items() if name == heading or name.startswith(heading + " ")), "")
            if len(substantive_text(value)) < 20:
                return fail(f"{slice_id} needs a substantive Slice-specific {label} section")

        tasks = list(TASK_RE.finditer(plan))
        if not tasks:
            return fail(f"{slice_id} plan needs concrete checkbox tasks with IDs and descriptions")
        for task in tasks:
            description = substantive_text(task.group(2))
            if len(description) < 12:
                return fail(f"{slice_id} has a non-substantive task description")
            if any(marker in task.group(2).lower() for marker in GENERIC_LINES):
                return fail(f"{slice_id} contains a template-only task description")
        if not re.search(r"^\s*-\s*files?\s*:\s*\S+", plan, re.I | re.M):
            return fail(f"{slice_id} plan must name concrete files")
        if not re.search(r"^\s*-\s*(?:red|green)\s*:\s*\S+", plan, re.I | re.M):
            return fail(f"{slice_id} plan must include RED/GREEN verification commands")
        fingerprint = substantive_text("\n".join(parsed.values())) + "\n" + plan_fingerprint(plan)
        if len(fingerprint) < 80:
            return fail(f"{slice_id} has insufficient Slice-specific content")
        digest = hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()
        if digest in fingerprints.values():
            other = next(key for key, value in fingerprints.items() if value == digest)
            return fail(f"Slices {other} and {slice_id} are template duplicates after ID normalization")
        fingerprints[slice_id] = digest

    print(json.dumps({"ok": True, "sliceCount": len(items), "distinctContent": len(fingerprints)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
