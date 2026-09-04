#!/usr/bin/env python3
"""Validate that a multi-Slice bundle contains substantive, distinct plans."""
import argparse
import difflib
import hashlib
import json
import pathlib
import re
import sys
from typing import Any


ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
SOURCE_HASH_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
GENERIC_LINES = (
    "implement the bounded slice from the accepted gdd",
    "the planned slice is ready for implementation",
    "read and validate requirements",
    "implement tasks",
    "run mapped evaluations",
    "review reciprocal gdd coverage",
    "planning-only test",
)
ID_TOKEN_RE = re.compile(r"\b(?:slice|task|eval|gdd)[-_][a-z0-9._-]+\b", re.I)
DATE_RE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
TASK_RE = re.compile(r"^\s*-\s*\[[ xX]\]\s+([^:]+):\s*(.+?)\s*$", re.M)
HEADING_RE = re.compile(r"^\s*#{1,6}\s+(.+?)\s*$", re.M)
STOP_WORDS = {"the", "a", "an", "and", "or", "to", "of", "for", "in", "on", "with", "from", "this", "that", "slice", "task", "plan"}
PLACEHOLDER_RE = re.compile(r"(?<![a-z0-9_-])(?:any|tbd|todo|implement later|fill in details|add appropriate|as needed|handle normally)(?![a-z0-9_-])", re.I)
TECHNICAL_TABLES = {
    "inputs": ("inputid", "name", "source", "type", "required", "constraints", "default"),
    "outputs": ("outputid", "name", "type", "shape", "guarantees"),
    "parameters boundaries": ("parameterid", "name", "type", "allowed range or enum", "boundary behavior"),
    "module interfaces": ("interfaceid", "provider", "consumer", "operation signature", "protocol or data contract"),
    "error exception scenarios": ("errorid", "condition", "detection", "response", "observable result"),
    "state invariants": ("invariantid", "state or transition", "invariant"),
    "acceptance mapping": ("acceptanceid", "behavior", "sourcemapping", "evalid"),
}
SPEC_REQUIRED = ("slice identity", "objective", "scope", "technical contract", "acceptance mapping", "out of scope")
PLAN_REQUIRED = ("implementation strategy", "dependency graph", "risk register", "execution constraints", "task checklist", "delivery checklist")


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


def _heading_key(value: str) -> str:
    value = re.sub(r"[^a-z0-9 ]", " ", value.lower())
    return re.sub(r"\s+", " ", value).strip()


def _cell_key(value: str) -> str:
    return _heading_key(value).replace(" ", "")


def _strip_code(value: str) -> str:
    """Normalize inline Markdown code spans without changing their contents."""
    return re.sub(r"`([^`]*)`", r"\1", value).strip()


def _concrete(value: str) -> bool:
    return bool(_strip_code(value)) and not PLACEHOLDER_RE.search(_strip_code(value))


def _split_row(line: str) -> list[str]:
    body = line.strip().strip("|")
    cells: list[str] = []
    current: list[str] = []
    code = False
    for char in body:
        if char == "`":
            code = not code
        if char == "|" and not code:
            cells.append("".join(current).strip())
            current = []
        else:
            current.append(char)
    cells.append("".join(current).strip())
    return cells


def _boundary(value: str) -> bool:
    text = _strip_code(value)
    if not _concrete(text):
        return False
    if text.lower() == "unbounded":
        return True
    number = r"-?(?:\d+(?:\.\d*)?|\.\d+)"
    identifier = r"[A-Za-z_][A-Za-z0-9_.-]*"
    operand = rf"(?:{number}|{identifier})"
    comparison = rf"{operand}\s*(?:<=|>=|==|<|>)\s*{operand}"
    increasing = rf"{number}\s*(?:<|<=)\s*{identifier}\s*(?:<|<=)\s*{number}"
    decreasing = rf"{number}\s*(?:>|>=)\s*{identifier}\s*(?:>|>=)\s*{number}"
    if re.fullmatch(comparison, text) or re.fullmatch(increasing, text) or re.fullmatch(decreasing, text):
        return True
    if "|" in text:
        members = [item.strip() for item in text.split("|")]
        return len(members) > 1 and all(re.fullmatch(r"[A-Za-z0-9_.-]+", item) for item in members)
    if len(text) >= 3 and (text[0], text[-1]) in (("[", "]"), ("{", "}")):
        members = [item.strip() for item in text[1:-1].split(",")]
        member = re.compile(r"(?:[A-Za-z0-9_.-]+|'[^'\n]+'|\"[^\"\n]+\")")
        return bool(members) and len(members) == len(set(members)) and all(member.fullmatch(item) for item in members)
    return False


def _parse_table(text: str, expected: tuple[str, ...], label: str) -> list[dict[str, str]]:
    lines = text.splitlines()
    candidates = []
    for index, line in enumerate(lines):
        if not line.lstrip().startswith("|"):
            continue
        if index + 1 >= len(lines) or not lines[index + 1].lstrip().startswith("|"):
            continue
        cells = _split_row(line)
        separator = _split_row(lines[index + 1])
        if len(cells) != len(expected) or len(separator) != len(expected) or any(not re.fullmatch(r":?-{3,}:?", item) for item in separator):
            if _heading_key(label) in text.lower():
                raise ValueError(f"malformed {label} table")
            continue
        if tuple(_cell_key(item) for item in cells) != tuple(_cell_key(item) for item in expected):
            raise ValueError(f"malformed {label} table columns")
        rows = []
        cursor = index + 2
        while cursor < len(lines) and lines[cursor].lstrip().startswith("|"):
            row = _split_row(lines[cursor])
            if len(row) != len(expected) or any(not item for item in row):
                raise ValueError(f"malformed {label} table row")
            rows.append(dict(zip(expected, row)))
            cursor += 1
        if not rows:
            raise ValueError(f"empty {label} table")
        candidates.extend(rows)
    if not candidates:
        raise ValueError(f"missing {label} table")
    return candidates


def _list_value(value: str) -> list[str]:
    value = _strip_code(value)
    if value.lower() in {"none", "-", "n/a"}:
        return []
    return [_strip_code(item) for item in re.split(r"\s*,\s*|\s*;\s*", value) if item.strip()]


def _command_value(value: str, expected: str) -> dict[str, str]:
    value = _strip_code(value)
    match = re.match(r"(.+?)\s*\(\s*expected\s*:\s*(fails|passes)\s*\)\s*$", value, re.I)
    if match:
        return {"command": _strip_code(match.group(1)), "expected": match.group(2).lower()}
    return {"command": value.strip(), "expected": expected}


def parse_markdown_contract(markdown: str, *, kind: str) -> dict[str, object]:
    """Return normalized sections, tables, task blocks, and identity metadata."""
    matches = list(HEADING_RE.finditer(markdown))
    parsed_sections: dict[str, str] = {}
    for index, match in enumerate(matches):
        key = _heading_key(match.group(1))
        if key in parsed_sections:
            raise ValueError(f"duplicate {kind} section: {key}")
        end = matches[index + 1].start() if index + 1 < len(matches) else len(markdown)
        parsed_sections[key] = markdown[match.end():end].strip()
    required = SPEC_REQUIRED if kind == "spec" else PLAN_REQUIRED
    for required_key in required:
        # Technical Contract is a container for the seven required subheadings;
        # its own body may therefore be empty while its children are populated.
        has_children = required_key == "technical contract" and any(name in TECHNICAL_TABLES for name in parsed_sections)
        if required_key not in parsed_sections or (not parsed_sections[required_key].strip() and not has_children):
            raise ValueError(f"missing or empty {kind} section: {required_key}")
    identity: dict[str, str] = {}
    # Metadata may live in a Slice Identity section or in the historical
    # frontmatter-like preamble; both describe the same visible contract.
    for match in re.finditer(r"^\s*-?\s*([A-Za-z][A-Za-z ]*):\s*`?([^`\n]+?)`?\s*$", markdown, re.M):
        identity[_heading_key(match.group(1)).replace(" ", "")] = match.group(2).strip()
    result: dict[str, object] = {"sections": parsed_sections, "identity": identity, "tables": {}}
    if kind == "spec":
        tables: dict[str, list[dict[str, str]]] = {}
        for section, columns in TECHNICAL_TABLES.items():
            section_text = parsed_sections.get(section)
            if section_text is None:
                raise ValueError(f"missing or empty spec section: {section}")
            tables[section] = _parse_table(section_text, columns, section)
            for row in tables[section]:
                if any(not _concrete(value) for value in row.values()):
                    raise ValueError(f"placeholder or empty value in {section} table")
            if section == "inputs" and any(not row["default"].strip() for row in tables[section]):
                raise ValueError("inputs require an explicit default")
            if section == "parameters boundaries" and any(not _boundary(row["allowed range or enum"]) for row in tables[section]):
                raise ValueError("parameters require a concrete boundary")
        result["tables"] = tables
    else:
        task_matches = list(re.finditer(r"^\s*-\s*\[[ xX]\]\s+([^:]+):\s*(.+?)\s*$", parsed_sections["task checklist"], re.M))
        if not task_matches:
            raise ValueError("plan task checklist needs checkbox tasks")
        tasks: list[dict[str, object]] = []
        checklist = parsed_sections["task checklist"]
        for index, match in enumerate(task_matches):
            end = task_matches[index + 1].start() if index + 1 < len(task_matches) else len(checklist)
            block = checklist[match.start():end]
            task_id = match.group(1).strip().strip("`")
            task: dict[str, object] = {"id": task_id, "description": match.group(2).strip()}
            fields: dict[str, str] = {}
            for field_match in re.finditer(r"^\s+-\s*([^:]+):\s*(.*?)\s*$", block, re.M):
                fields[_heading_key(field_match.group(1))] = field_match.group(2).strip()
            required_fields = ("files", "consumes", "produces", "depends on", "source mappings", "serves evaluations", "red", "green", "verification", "review")
            missing = [field for field in required_fields if field not in fields or not fields[field]]
            if missing:
                raise ValueError(f"task {task_id} missing field: {missing[0]}")
            task["files"] = _list_value(fields["files"])
            task["consumes"] = _list_value(fields["consumes"])
            task["produces"] = _list_value(fields["produces"])
            task["dependsOn"] = _list_value(fields["depends on"])
            task["sourceMappings"] = _list_value(fields["source mappings"])
            task["servesEvaluations"] = _list_value(fields["serves evaluations"])
            task["red"] = _command_value(fields["red"], "fails")
            task["green"] = _command_value(fields["green"], "passes")
            verification = fields["verification"]
            paths = re.findall(r"/[A-Za-z0-9_./-]+", verification)
            if "observation paths" in fields:
                paths = _list_value(fields["observation paths"])
            task["verification"] = {"assertions": [verification], "observationPaths": paths or []}
            review = fields["review"].lower()
            minimum = "independent_actor" if "independent" in review else "separate_context" if "separate" in review else "self"
            task["review"] = {"minimumLevel": minimum}
            tasks.append(task)
        result["tasks"] = tasks
        constraints = parsed_sections["execution constraints"]
        allowed_matches = re.findall(r"^\s*-\s*allowedFiles\s*:\s*(.+?)\s*$", constraints, re.I | re.M)
        if len(allowed_matches) != 1:
            raise ValueError("execution constraints must declare allowedFiles exactly once")
        allowed_files = _list_value(allowed_matches[0])
        if not allowed_files:
            raise ValueError("execution constraints allowedFiles must be non-empty")
        result["allowedFiles"] = allowed_files
    return result


def _canonical_hash(value: object) -> str:
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def _validate_plan_json(plan_json: dict[str, object]) -> bool:
    """Apply the same exact task/technical shape required by SlicePlan V2."""
    try:
        from slice_contract import _technical_contract
    except ImportError:
        return False
    coverage = plan_json.get("coverageMode")
    common = {"schemaVersion", "coverageMode", "planRevision", "allowedFiles", "tasks", "technicalContract"}
    if coverage == "gdd":
        expected_keys = common | {"inventoryHash", "requirementIds"}
    elif coverage == "non_gdd":
        expected_keys = common | {"sourceProfileHash", "nonGddRationale"}
    else:
        return False
    if set(plan_json) != expected_keys or plan_json.get("schemaVersion") != 2:
        return False
    allowed = plan_json.get("allowedFiles")
    if not isinstance(allowed, list) or not allowed or len(allowed) != len(set(allowed)):
        return False
    if any(not isinstance(path, str) or not path.strip() or path.startswith(("/", "\\")) or any(segment in {"", ".", ".."} for segment in path.split("/")) for path in allowed):
        return False
    tasks = plan_json.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        return False
    task_keys = {"id", "files", "dependsOn", "servesEvaluations", "red", "green", "review", "sourceMappings", "consumes", "produces", "verification"}
    task_ids: list[str] = []
    source_mappings: set[str] = set()
    eval_ids: set[str] = set()
    for task in tasks:
        if not isinstance(task, dict) or set(task) != task_keys:
            return False
        task_id = task.get("id")
        if not isinstance(task_id, str) or not ID_RE.fullmatch(task_id) or task_id in task_ids:
            return False
        task_ids.append(task_id)
        for field in ("files", "dependsOn", "servesEvaluations", "sourceMappings", "consumes", "produces"):
            values = task.get(field)
            if not isinstance(values, list) or len(values) != len(set(values)) or any(not isinstance(item, str) or not item.strip() for item in values):
                return False
        if any(path not in allowed for path in task["files"]):
            return False
        if any(dep not in task_ids[:-1] for dep in task["dependsOn"]):
            return False
        source_mappings.update(task["sourceMappings"])
        eval_ids.update(task["servesEvaluations"])
        for command, expected in (("red", "fails"), ("green", "passes")):
            value = task.get(command)
            if not isinstance(value, dict) or set(value) != {"command", "expected"} or value.get("expected") != expected or not isinstance(value.get("command"), str) or not value["command"].strip():
                return False
        review = task.get("review")
        if not isinstance(review, dict) or set(review) != {"minimumLevel"} or review.get("minimumLevel") not in {"self", "separate_context", "independent_actor"}:
            return False
        verification = task.get("verification")
        if not isinstance(verification, dict) or set(verification) != {"assertions", "observationPaths"}:
            return False
        if not isinstance(verification["assertions"], list) or not verification["assertions"] or any(not isinstance(item, str) or not item.strip() for item in verification["assertions"]):
            return False
        if not isinstance(verification["observationPaths"], list) or not verification["observationPaths"] or any(not isinstance(item, str) or not item.startswith("/") for item in verification["observationPaths"]):
            return False
    if set().union(*(set(task["files"]) for task in tasks)) != set(allowed):
        return False
    if not _technical_contract(plan_json.get("technicalContract"), set(task_ids), eval_ids, source_mappings | set(plan_json.get("requirementIds", []))):
        return False
    return True


def compare_markdown_to_plan(spec: dict[str, object], plan: dict[str, object], plan_json: dict[str, object], source_profile: dict[str, object]) -> str | None:
    """Return the first stable failure message, or None when every field matches."""
    identity = spec.get("identity", {})
    plan_identity = plan.get("identity", {})
    slice_id = identity.get("sliceid")
    if not isinstance(slice_id, str) or (plan_identity.get("sliceid") is not None and slice_id != plan_identity.get("sliceid")):
        return "Markdown sliceId does not match paired plan"
    if plan_json.get("schemaVersion") != 2:
        return "V2 plan JSON must have schemaVersion 2"
    if plan_json.get("planRevision") != identity.get("planrevision") or (plan_identity.get("planrevision") is not None and plan_json.get("planRevision") != plan_identity.get("planrevision")):
        return "Markdown planRevision does not match plan JSON"
    profile_hash = _canonical_hash(source_profile)
    if plan_json.get("coverageMode") == "non_gdd" and plan_json.get("sourceProfileHash") != profile_hash:
        return "plan JSON sourceProfileHash does not match source profile"
    spec_sources = identity.get("sourcemappings")
    plan_sources = plan_identity.get("sourcemappings")
    if plan_sources is not None and spec_sources is not None and plan_sources != spec_sources:
        return "Markdown source mappings differ between Spec and Plan"
    declared_sources = set(_list_value(spec_sources)) if isinstance(spec_sources, str) else set()
    task_sources = {value for task in plan.get("tasks", []) if isinstance(task, dict) for value in task.get("sourceMappings", [])}
    if declared_sources and declared_sources != task_sources:
        return "Plan tasks do not cover Spec source mappings"
    spec_tables = spec.get("tables", {})
    technical = plan_json.get("technicalContract")
    if not isinstance(technical, dict):
        return "plan JSON technicalContract is missing"
    table_map = {"inputs": "inputs", "outputs": "outputs", "parameters boundaries": "parameters", "module interfaces": "interfaces", "error exception scenarios": "errors", "state invariants": "invariants", "acceptance mapping": "acceptance"}
    table_fields = {
        "inputs": {"inputid": "id"},
        "outputs": {"outputid": "id"},
        "parameters": {"parameterid": "id", "allowed range or enum": "bounds", "boundary behavior": "boundaryBehavior"},
        "interfaces": {"interfaceid": "id", "operation signature": "operation", "protocol or data contract": "protocol"},
        "errors": {"errorid": "id", "observable result": "observable"},
        "invariants": {"invariantid": "id", "state or transition": "state", "invariant": "rule"},
        "acceptance": {"acceptanceid": "id", "sourcemapping": "sourceMappings", "evalid": "evalIds"},
    }
    for markdown_name, json_name in table_map.items():
        rows = spec_tables.get(markdown_name, [])
        expected_rows = technical.get(json_name, [])
        if not isinstance(expected_rows, list):
            return f"invalid {json_name} technical rows"
        markdown_ids = []
        for row in rows:
            markdown_id = _strip_code(row[next(iter(row))])
            markdown_ids.append(markdown_id)
        json_ids = [item.get("id") for item in expected_rows if isinstance(item, dict)]
        if markdown_ids != json_ids:
            return f"Markdown {json_name} technical IDs differ from plan JSON"
        mapping = table_fields[json_name]
        for row, expected in zip(rows, expected_rows):
            if not isinstance(expected, dict):
                return f"invalid {json_name} technical rows"
            normalized: dict[str, object] = {}
            for column, value in row.items():
                key = mapping.get(column, column)
                if key in {"sourceMappings", "evalIds"}:
                    normalized[key] = _list_value(value)
                elif key == "required":
                    normalized[key] = value.strip("`").lower() in {"yes", "true", "required"}
                else:
                    normalized[key] = _strip_code(value)
            for key, value in normalized.items():
                if key in expected and expected[key] != value:
                    return f"Markdown {json_name} technical fields differ from plan JSON"
            if json_name == "acceptance":
                source_mappings = _list_value(row["sourcemapping"])
                acceptance_evals = _list_value(row["evalid"])
                if source_mappings != expected.get("sourceMappings") or acceptance_evals != expected.get("evalIds"):
                    return "acceptance mapping does not match source/Eval contract"
    tasks = plan.get("tasks", [])
    json_tasks = plan_json.get("tasks", [])
    if not isinstance(tasks, list) or not isinstance(json_tasks, list) or len(tasks) != len(json_tasks):
        return "Markdown task fields differ from plan JSON"
    task_fields = ("id", "files", "consumes", "produces", "dependsOn", "sourceMappings", "servesEvaluations", "red", "green", "verification", "review")
    for markdown_task, json_task in zip(tasks, json_tasks):
        if not isinstance(json_task, dict) or any(markdown_task.get(field) != json_task.get(field) for field in task_fields):
            return "Markdown task fields differ from plan JSON"
    task_ids = [task.get("id") for task in tasks if isinstance(task, dict)]
    for index, task in enumerate(tasks):
        if not isinstance(task, dict):
            return "invalid Markdown task"
        if any(dep not in task_ids[:index] for dep in task.get("dependsOn", [])):
            return "task dependencies must point to earlier tasks"
    allowed = plan_json.get("allowedFiles", [])
    markdown_allowed = plan.get("allowedFiles", [])
    if markdown_allowed != allowed:
        return "Markdown allowedFiles differ from plan JSON"
    owned = {file for task in tasks if isinstance(task, dict) for file in task.get("files", [])}
    if any(file not in allowed for file in owned):
        return "task files must be a subset of allowedFiles"
    if any(file not in owned for file in allowed):
        return "allowed file is not owned by a Markdown task"
    return None


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


def semantic_tokens(value: str) -> set[str]:
    normalized = substantive_text(value)
    return {token for token in re.findall(r"[a-z0-9]+", normalized) if token not in STOP_WORDS and len(token) > 2}


def materially_similar(left: str, right: str) -> bool:
    left_tokens = semantic_tokens(left)
    right_tokens = semantic_tokens(right)
    if not left_tokens or not right_tokens:
        return False
    jaccard = len(left_tokens & right_tokens) / len(left_tokens | right_tokens)
    sequence = difflib.SequenceMatcher(None, " ".join(sorted(left_tokens)), " ".join(sorted(right_tokens))).ratio()
    # A small amount of wording variation must not hide a plan that keeps the
    # same actors, state transitions, files, and verification shape.
    return jaccard >= 0.68 or sequence >= 0.82


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
    if not isinstance(items, list) or len(items) < 2:
        return fail("decomposition bundle requires at least two Slices for a multi-Slice plan")

    seen: set[str] = set()
    fingerprints: dict[str, str] = {}
    fingerprint_texts: dict[str, str] = {}
    strict_bundle = payload.get("contractVersion") == 2
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

        # V2 pairs bind the Markdown to the exact structured plan and source
        # profile used by preflight. Version-1 bundles without these paths stay
        # on the historical read-only checks for compatibility.
        item_v2 = strict_bundle or "planJsonPath" in item or "sourceProfilePath" in item or item.get("contractVersion") == 2
        if item_v2:
            if not isinstance(item.get("planJsonPath"), str) or not isinstance(item.get("sourceProfilePath"), str):
                return fail(f"{slice_id} V2 decomposition requires planJsonPath and sourceProfilePath")
            try:
                plan_json = json.loads((args.path.parent / item["planJsonPath"]).resolve().read_text(encoding="utf-8"))
                source_profile = json.loads((args.path.parent / item["sourceProfilePath"]).resolve().read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                return fail(f"{slice_id} V2 structured artifacts are unreadable: {exc}")
            if not isinstance(plan_json, dict) or not isinstance(source_profile, dict):
                return fail(f"{slice_id} V2 structured artifacts must be objects")
            try:
                from slice_contract import validate_contract_case
                profile_decision = validate_contract_case("sourceProfile", source_profile)
            except (ImportError, ValueError, TypeError):
                profile_decision = {"accepted": False, "reasonCode": "SLICE_SOURCE_PROFILE_INVALID"}
            if profile_decision.get("accepted") is not True:
                return fail(f"{slice_id} SourceProfile is invalid: {profile_decision.get('reasonCode', 'SLICE_SOURCE_PROFILE_INVALID')}")
            if not _validate_plan_json(plan_json):
                return fail(f"{slice_id} SlicePlan JSON has invalid technical/task schema")
            if "revision" in source_profile and source.get("revision") != source_profile.get("revision"):
                return fail(f"{slice_id} source revision does not match SourceProfile")
            if "contentHash" in source_profile and source.get("contentHash") != source_profile.get("contentHash"):
                return fail(f"{slice_id} source content hash does not match SourceProfile")
            for source_key, profile_key in (("project", "project"), ("document", "document")):
                if profile_key in source_profile and source_profile.get(profile_key) != source.get(source_key):
                    return fail(f"{slice_id} source {source_key} does not match SourceProfile")
            try:
                parsed_spec = parse_markdown_contract(spec, kind="spec")
                parsed_plan = parse_markdown_contract(plan, kind="plan")
            except ValueError as exc:
                return fail(f"{slice_id} {exc}")
            mismatch = compare_markdown_to_plan(parsed_spec, parsed_plan, plan_json, source_profile)
            if mismatch:
                return fail(f"{slice_id} {mismatch}")
            bundle_eval_ids = item.get("evalIds")
            plan_eval_ids = []
            if isinstance(plan_json.get("tasks"), list):
                for task in plan_json["tasks"]:
                    if isinstance(task, dict) and isinstance(task.get("servesEvaluations"), list):
                        plan_eval_ids.extend(task["servesEvaluations"])
            technical_plan = plan_json.get("technicalContract")
            if isinstance(technical_plan, dict) and isinstance(technical_plan.get("acceptance"), list):
                for row in technical_plan["acceptance"]:
                    if isinstance(row, dict) and isinstance(row.get("evalIds"), list):
                        plan_eval_ids.extend(row["evalIds"])
            if not isinstance(bundle_eval_ids, list) or list(dict.fromkeys(plan_eval_ids)) != bundle_eval_ids:
                return fail(f"{slice_id} Eval IDs differ from paired plan JSON")

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
        for index, task in enumerate(tasks):
            end = tasks[index + 1].start() if index + 1 < len(tasks) else len(plan)
            task_block = plan[task.start():end]
            if not re.search(r"^\s*-\s*RED\s*:\s*\S+", task_block, re.I | re.M) or not re.search(r"^\s*-\s*GREEN\s*:\s*\S+", task_block, re.I | re.M):
                return fail(f"{slice_id} every task must include both RED and GREEN verification commands")
        fingerprint = substantive_text("\n".join(parsed.values())) + "\n" + plan_fingerprint(plan)
        if len(fingerprint) < 80:
            return fail(f"{slice_id} has insufficient Slice-specific content")
        digest = hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()
        if digest in fingerprints.values():
            other = next(key for key, value in fingerprints.items() if value == digest)
            return fail(f"Slices {other} and {slice_id} are template duplicates after ID normalization")
        for other, other_fingerprint in fingerprint_texts.items():
            if materially_similar(fingerprint, other_fingerprint):
                return fail(f"Slices {other} and {slice_id} are materially duplicate by semantic similarity")
        fingerprints[slice_id] = digest
        fingerprint_texts[slice_id] = fingerprint

    print(json.dumps({"ok": True, "sliceCount": len(items), "distinctContent": len(fingerprints)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
