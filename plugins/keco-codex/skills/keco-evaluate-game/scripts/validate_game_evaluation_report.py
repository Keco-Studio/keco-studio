#!/usr/bin/env python3
"""Strictly validate a Keco two-dimension game evaluation report."""

import argparse
import json
import pathlib
import sys
from typing import Any

from progress_log import append_event


EXPECTED = {
    "artStyle": {"styleConsistency": 20, "assetQualityAndFit": 15, "uiReadabilityAndLayout": 10, "visualFeedbackAndEmotion": 5},
    "playerFun": {"coreLoopAppeal": 20, "meaningfulChoices": 15, "feedbackPacingAndGoals": 10, "motivationToContinue": 5},
}
THRESHOLDS = {"alpha": 60, "beta": 70, "rc": 80, "release": 85}
STATUSES = {"passed", "conditional", "partial", "failed", "blocked"}
ITEM_STATUSES = {"evaluated", "not_evaluated"}
SEVERITIES = ("P0", "P1", "P2", "P3")


def text(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def strings(value: Any, allow_empty: bool = False) -> bool:
    return isinstance(value, list) and (allow_empty or bool(value)) and all(text(item) for item in value)


def number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def score_value(value: Any, maximum: int, label: str) -> None:
    if not number(value) or not 0 <= value <= maximum:
        raise ValueError(f"{label} must be between 0 and {maximum}")


def validate_item(item: Any, dimension: str, item_id: str, maximum: int) -> None:
    if not isinstance(item, dict) or item.get("dimension") != dimension or item.get("itemId") != item_id:
        raise ValueError("Claude review item identity is invalid")
    if item.get("max") != maximum:
        raise ValueError(f"Claude review item maximum for {item_id} is invalid")
    if item.get("status") not in ITEM_STATUSES:
        raise ValueError("Claude review item status is invalid")
    if not text(item.get("reason")) or not strings(item.get("limitations")) or not text(item.get("nextIteration")):
        raise ValueError("Claude review item requires reason, limitations, and next iteration")
    if item["status"] == "evaluated":
        score_value(item.get("score"), maximum, f"Claude review score for {item_id}")
        if not strings(item.get("evidence")):
            raise ValueError("evaluated Claude review item requires evidence")
    else:
        if item.get("score") is not None or not strings(item.get("evidence"), allow_empty=True):
            raise ValueError("not_evaluated Claude review item must have null score")


def validate_claude(review: Any) -> tuple[dict[str, Any], float, Any]:
    if not isinstance(review, dict) or review.get("status") not in {"complete", "pending"}:
        raise ValueError("claudeReview status is invalid")
    dimensions = review.get("dimensions")
    if not isinstance(dimensions, dict) or list(dimensions) != list(EXPECTED):
        raise ValueError("claudeReview must contain only artStyle and playerFun")
    all_items = []
    for dimension, expected in EXPECTED.items():
        entry = dimensions.get(dimension)
        if not isinstance(entry, dict) or entry.get("max") != 50 or not isinstance(entry.get("items"), list):
            raise ValueError(f"{dimension} dimension is invalid")
        if len(entry["items"]) != 4:
            raise ValueError(f"{dimension} must contain four items")
        expected_ids = list(expected)
        actual_ids = [item.get("itemId") if isinstance(item, dict) else None for item in entry["items"]]
        if actual_ids != expected_ids:
            raise ValueError(f"{dimension} items must match the fixed order")
        for item_data, item_id in zip(entry["items"], expected_ids):
            validate_item(item_data, dimension, item_id, expected[item_id])
            all_items.append(item_data)
        complete = all(item_data["status"] == "evaluated" for item_data in entry["items"])
        expected_score = sum(item_data["score"] for item_data in entry["items"]) if complete else None
        if entry.get("score") != expected_score:
            raise ValueError(f"{dimension} dimension score does not equal item sum")
    complete = all(item_data["status"] == "evaluated" for item_data in all_items)
    total = sum(item_data["score"] for item_data in all_items) if complete else None
    total_entry = review.get("total")
    if not isinstance(total_entry, dict) or total_entry.get("max") != 100 or total_entry.get("score") != total:
        raise ValueError("Claude total does not equal complete dimension sums")
    expected_status = "complete" if complete else "pending"
    if review["status"] != expected_status:
        raise ValueError("Claude review status does not match evaluated items")
    return review, len([item for item in all_items if item["status"] == "evaluated"]) / 8, total


def validate_human(review: Any) -> Any:
    if not isinstance(review, dict) or set(review) != {"artStyle", "playerFun", "total"}:
        raise ValueError("humanReview must contain artStyle, playerFun, and total")
    completed_dimensions = 0
    total = 0
    for dimension in EXPECTED:
        entry = review[dimension]
        if not isinstance(entry, dict):
            raise ValueError("human review dimension must be an object")
        if entry.get("max") != 50 or not text(entry.get("comment")) or not text(entry.get("nextIteration")):
            if entry.get("score") is None and entry.get("comment") is None and entry.get("nextIteration") is None and entry.get("max") == 50:
                continue
            raise ValueError("human review fields must be all empty or complete")
        score_value(entry.get("score"), 50, f"human {dimension} score")
        completed_dimensions += 1
        total += entry["score"]
    total_entry = review["total"]
    if not isinstance(total_entry, dict) or total_entry.get("max") != 100:
        raise ValueError("human total is invalid")
    if completed_dimensions == 2:
        if total_entry.get("score") != total:
            raise ValueError("human total does not equal dimension sums")
    elif completed_dimensions == 0:
        if total_entry.get("score") is not None:
            raise ValueError("empty human review must have a null total")
    else:
        raise ValueError("human review must be entirely empty or complete in both dimensions")
    return review


def validate(report: Any) -> None:
    if not isinstance(report, dict) or report.get("version") != 1:
        raise ValueError("report must be a version 1 object")
    if "combinedScore" in report:
        raise ValueError("combinedScore is not allowed; Claude and human reviews stay separate")
    required = {"reportId", "profileId", "buildHash", "gddRevision", "stage", "genre", "sourceReferences", "claudeReview", "humanReview", "coverage", "mandatoryEvaluations", "findings", "severityCounts", "decision"}
    if required - report.keys():
        raise ValueError("report lacks required fields")
    allowed = required | {"version", "technicalEvidence"}
    if report.keys() - allowed:
        raise ValueError("report contains unsupported fields")
    if report["reportId"] != f"{report['profileId']}-report":
        raise ValueError("reportId identity does not match profileId")
    if not all(text(report.get(key)) for key in ("profileId", "buildHash", "gddRevision", "stage", "genre")):
        raise ValueError("report identity fields must be non-empty")
    sources = report["sourceReferences"]
    if not isinstance(sources, dict) or sources.get("gddRevision") != report["gddRevision"] or sources.get("godotBuildHash") != report["buildHash"]:
        raise ValueError("source reference identity does not match report")
    if not text(sources.get("roadmapRevision")) or not text(sources.get("sourceSnapshot")) or not strings(sources.get("sliceEvalReports")):
        raise ValueError("source references must include Slice EvalReport evidence")
    _, coverage, total = validate_claude(report["claudeReview"])
    if not number(report["coverage"]) or abs(report["coverage"] - coverage) > 0.000001:
        raise ValueError("coverage does not match Claude item states")
    validate_human(report["humanReview"])
    mandatory = report["mandatoryEvaluations"]
    if not isinstance(mandatory, list):
        raise ValueError("mandatoryEvaluations must be an array")
    mandatory_ids = set()
    for item in mandatory:
        if not isinstance(item, dict) or not text(item.get("evalId")) or item["evalId"] in mandatory_ids or item.get("status") not in {"passed", "failed", "blocked", "manual_required"} or not strings(item.get("evidence")):
            raise ValueError("mandatory evaluation is invalid")
        mandatory_ids.add(item["evalId"])
    findings = report["findings"]
    if not isinstance(findings, list):
        raise ValueError("findings must be an array")
    issue_ids = set()
    counts = {severity: 0 for severity in SEVERITIES}
    valid_metrics = {f"{dimension}.{item_id}" for dimension, values in EXPECTED.items() for item_id in values}
    for finding in findings:
        if not isinstance(finding, dict) or not text(finding.get("issueId")) or finding["issueId"] in issue_ids or finding.get("severity") not in counts or finding.get("primaryMetricId") not in valid_metrics or not strings(finding.get("evidence")):
            raise ValueError("finding is invalid or duplicated")
        issue_ids.add(finding["issueId"])
        linked = finding.get("linkedMetricIds")
        if not isinstance(linked, list) or any(item not in valid_metrics for item in linked):
            raise ValueError("finding linked metrics are invalid")
        counts[finding["severity"]] += 1
    if report["severityCounts"] != counts:
        raise ValueError("severity counts do not match findings")
    decision = report["decision"]
    if not isinstance(decision, dict) or decision.get("stage") != report["stage"] or decision.get("status") not in STATUSES or not isinstance(decision.get("reasons"), list) or decision.get("threshold") != THRESHOLDS.get(report["stage"]):
        raise ValueError("decision is invalid")
    if report["stage"] in {"rc", "release"} and decision["status"] == "conditional":
        raise ValueError("RC and Release cannot be conditional")
    if decision["status"] == "passed":
        if total is None or (THRESHOLDS.get(report["stage"]) is not None and total < THRESHOLDS[report["stage"]]) or counts["P0"] or counts["P1"] or any(item["status"] != "passed" for item in mandatory) or coverage < (1.0 if report["stage"] in {"rc", "release"} else 0.9 if report["stage"] == "beta" else 0.7):
            raise ValueError("passed report violates a score, risk, mandatory, or coverage gate")


def append_progress(report_path: pathlib.Path, report: dict[str, Any]) -> None:
    append_event(
        report_path.parent, "validate", "\u6821\u9a8c\u8bc4\u4ef7\u62a5\u544a\u5951\u7ea6\u548c\u9636\u6bb5\u95e8\u7981",
        {"reportId": report["reportId"]},
        "validate_game_evaluation_report.py", "\u62a5\u544a\u7ed3\u6784\u3001\u8bc1\u636e\u548c\u5206\u6570\u4e00\u81f4",
        {"status": report["decision"]["status"], "total": report["claudeReview"]["total"]["score"]},
        "\u62a5\u544a\u53ef\u4ee5\u4f5c\u4e3a\u5f53\u524d\u8bc4\u4ef7\u7ed3\u679c\u4f7f\u7528\uff0c\u4f46\u4eba\u5de5\u8bc4\u4ef7\u4ecd\u72ec\u7acb\u4fdd\u5b58",
        "\u6839\u636e decision \u8fdb\u5165\u62a5\u544a\u3001\u6539\u8fdb\u6216\u91cd\u6d4b\u6d41\u7a0b",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=pathlib.Path)
    args = parser.parse_args()
    try:
        report = json.loads(args.path.read_text(encoding="utf-8"))
        validate(report)
        append_progress(args.path, report)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    report = json.loads(args.path.read_text(encoding="utf-8"))
    print(json.dumps({"ok": True, "status": report["decision"]["status"], "stage": report["stage"], "score": report["claudeReview"]["total"]["score"], "coverage": report["coverage"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
