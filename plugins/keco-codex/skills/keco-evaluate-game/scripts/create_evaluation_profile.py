#!/usr/bin/env python3
"""Create a deterministic locked 80+20 EDD game evaluation profile."""

import argparse
import json
import pathlib
import re
import sys
from typing import Any


THRESHOLDS = {"alpha": 60, "beta": 70, "rc": 80, "release": 85}
STAGES = {"slice", *THRESHOLDS}
COMMON_ANCHORS = {
    "1": "The intended experience repeatedly fails or blocks the player.",
    "3": "The experience works but has concrete, repeatable friction.",
    "5": "The goal is reliably achieved and strengthens the experience.",
}


def metric(group: str, key: str, name: str, weight: int, evidence: list[str]) -> dict[str, Any]:
    return {
        "id": f"{group}.{key}",
        "groupId": group,
        "name": name,
        "weight": weight,
        "anchors": dict(COMMON_ANCHORS),
        "requiredEvidence": evidence,
    }


GENERAL_METRICS = [
    metric("general.core", "core-loop", "Core loop functions and is understood", 4, ["playtest event", "observer record"]),
    metric("general.core", "meaningful-decisions", "Player decisions materially change outcomes", 4, ["choice outcome", "player explanation"]),
    metric("general.core", "action-reward", "Actions, feedback, and rewards correspond", 4, ["playtest event", "runtime or observer record"]),
    metric("general.core", "retry-motivation", "Players want to retry after failure", 3, ["retry or exit event"]),
    metric("general.core", "repetition-fatigue", "Repetition avoids avoidable fatigue", 3, ["playtest event", "player explanation"]),
    metric("general.clarity", "initial-goal", "Initial goal is clear", 2, ["player action", "observer record"]),
    metric("general.clarity", "core-rules", "Core rules are understandable", 2, ["player explanation"]),
    metric("general.clarity", "next-action", "Next meaningful action can be identified", 2, ["player action", "observer record"]),
    metric("general.clarity", "outcome-causes", "Success and failure causes are understandable", 2, ["player explanation"]),
    metric("general.interaction", "input-response", "Input response is timely", 3, ["runtime measurement or playtest event"]),
    metric("general.interaction", "predictability", "Results are predictable from input", 3, ["playtest event"]),
    metric("general.interaction", "state-feedback", "State changes are legible", 3, ["player identification", "observer record"]),
    metric("general.interaction", "interface-recovery", "Interface interaction is accurate and recoverable", 3, ["playtest event"]),
    metric("general.pacing", "difficulty", "Difficulty progresses coherently", 3, ["failure distribution", "player event"]),
    metric("general.pacing", "intensity", "Intensity varies appropriately", 2, ["playtest timeline"]),
    metric("general.pacing", "idle-time", "Waiting, idle time, and repeated travel are controlled", 2, ["playtest timeline"]),
    metric("general.pacing", "content-introduction", "Tutorials and new content arrive at useful times", 2, ["playtest event"]),
    metric("general.pacing", "reward-spacing", "Goals and rewards have effective spacing", 1, ["playtest timeline"]),
    metric("general.systems", "complete-loop", "Core systems form a complete loop", 3, ["runtime flow evidence"]),
    metric("general.systems", "viable-choices", "Strategies, roles, and resource choices are viable", 3, ["choice distribution", "outcome evidence"]),
    metric("general.systems", "system-linkage", "Systems interact consistently", 2, ["runtime state evidence"]),
    metric("general.systems", "economy-progression", "Progression and resource pacing are sustainable", 2, ["runtime metrics"]),
    metric("general.presentation", "visual-legibility", "Important objects and states are visually legible", 2, ["target-player identification"]),
    metric("general.presentation", "style-consistency", "Character, environment, and UI styles are coherent", 2, ["target-player review"]),
    metric("general.presentation", "action-reinforcement", "Animation and audio reinforce actions", 2, ["target-player event"]),
    metric("general.presentation", "ui-readability", "UI hierarchy and text are readable", 2, ["target-player identification"]),
    metric("general.stability", "crash-block", "Crash, freeze, and flow-blocking behavior", 3, ["runtime log"]),
    metric("general.stability", "frame-pacing", "Frame pacing and response are stable", 2, ["performance measurement"]),
    metric("general.stability", "loading", "Startup, loading, and transitions are controlled", 1, ["timing measurement"]),
    metric("general.stability", "persistence", "Save/load and persistent state are intact", 2, ["persistence evaluation"]),
    metric("general.accessibility", "readability", "Text, contrast, and information are readable", 2, ["accessibility review"]),
    metric("general.accessibility", "settings", "Relevant input, audio, and display settings exist", 2, ["settings review"]),
    metric("general.accessibility", "content-protection", "Sensitive content and player protection are appropriate", 1, ["content review"]),
    metric("general.accessibility", "action-transparency", "Data, permission, and destructive actions are transparent", 1, ["safety review"]),
]


GENRE_ITEMS = {
    "action": [
        ("combat-response", "Combat input and action response"),
        ("combat-feedback", "Attack, damage, and evasion feedback"),
        ("enemy-readability", "Enemy behavior and attack readability"),
        ("tactical-space", "Skill and tactical combination space"),
        ("combat-fairness", "Difficulty, fairness, and recovery opportunity"),
    ],
    "rpg": [
        ("character-growth", "Perceptible character growth"),
        ("builds", "Equipment, skill, or attribute builds"),
        ("quest-exploration", "Quest and exploration motivation"),
        ("narrative-engagement", "Character, relationship, and narrative engagement"),
        ("progression-linkage", "Progression linkage to the core loop"),
    ],
    "simulation-management": [
        ("production-loop", "Production and consumption loop"),
        ("resource-strategy", "Resource constraints and strategic choice"),
        ("goal-horizons", "Short-term feedback and long-term goals"),
        ("consequence-legibility", "Legibility of systemic consequences"),
        ("recovery-pacing", "Failure recovery and management pacing"),
    ],
    "puzzle": [
        ("rule-expression", "Puzzle rule expression"),
        ("reasoning-chain", "Logical completeness of the reasoning chain"),
        ("difficulty-progression", "Difficulty progression"),
        ("hint-support", "Proportionate hint support"),
        ("solution-satisfaction", "Earned solution satisfaction"),
    ],
    "visual-novel-narrative": [
        ("narrative-pacing", "Narrative pacing and information release"),
        ("characterization", "Characterization and relationship change"),
        ("meaningful-choice", "Meaningful player choice"),
        ("branch-continuity", "Branch logic and continuity"),
        ("emotional-reinforcement", "Text, staging, and emotional reinforcement"),
    ],
    "strategy": [
        ("viable-strategies", "Decision space and viable strategies"),
        ("information", "Information transparency and predictability"),
        ("counterplay", "Risk, reward, and counterplay"),
        ("adaptation", "Adaptation to changing situations"),
        ("match-structure", "Opening, midgame, and endgame structure"),
    ],
    "platformer": [
        ("movement-precision", "Movement and jump precision"),
        ("spatial-readability", "Landing, collision, and spatial readability"),
        ("obstacle-progression", "Obstacle composition and progression"),
        ("retry-cost", "Failure and retry cost"),
        ("route-flow", "Flow and route variation"),
    ],
}


def specialized_metrics(genre: str) -> list[dict[str, Any]]:
    return [
        metric(f"specialized.{genre}", key, name, 4, ["target-player evidence", "playtest event"])
        for key, name in GENRE_ITEMS[genre]
    ]


def load_json(path: pathlib.Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid specialized config: {exc}") from exc


def validate_custom_metric(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("custom metrics must be objects")
    required = {"id", "name", "weight", "gddSource", "anchors", "requiredEvidence"}
    if required - value.keys():
        raise ValueError("custom metric lacks required fields")
    if not isinstance(value["id"], str) or not value["id"].startswith("specialized.project."):
        raise ValueError("custom metric ID must start with specialized.project.")
    if not isinstance(value["weight"], int) or isinstance(value["weight"], bool) or value["weight"] <= 0:
        raise ValueError("custom metric weight must be a positive integer")
    anchors = value["anchors"]
    if not isinstance(anchors, dict) or set(anchors) != {"1", "3", "5"} or not all(
        isinstance(item, str) and item.strip() for item in anchors.values()
    ):
        raise ValueError("custom metric anchors must contain non-empty 1, 3, and 5 values")
    evidence = value["requiredEvidence"]
    if not isinstance(evidence, list) or not evidence or not all(isinstance(item, str) and item.strip() for item in evidence):
        raise ValueError("custom metric requiredEvidence must be a non-empty string array")
    if not isinstance(value["name"], str) or not value["name"].strip() or not isinstance(value["gddSource"], str) or not value["gddSource"].strip():
        raise ValueError("custom metric name and gddSource are required")
    return {
        "id": value["id"],
        "groupId": "specialized",
        "name": value["name"],
        "weight": value["weight"],
        "gddSource": value["gddSource"],
        "anchors": anchors,
        "requiredEvidence": evidence,
    }


def apply_customization(base: list[dict[str, Any]], config: Any) -> list[dict[str, Any]]:
    if not isinstance(config, dict):
        raise ValueError("specialized config must be an object")
    replacements = config.get("replaceMetricIds", [])
    custom_values = config.get("customMetrics", [])
    if not isinstance(replacements, list) or not all(isinstance(item, str) for item in replacements):
        raise ValueError("replaceMetricIds must be a string array")
    if not isinstance(custom_values, list):
        raise ValueError("customMetrics must be an array")
    custom = [validate_custom_metric(item) for item in custom_values]
    custom_weight = sum(item["weight"] for item in custom)
    if custom_weight > 10:
        raise ValueError("custom specialized weight must not exceed 10")
    base_by_id = {item["id"]: item for item in base}
    if len(replacements) != len(set(replacements)) or any(item not in base_by_id for item in replacements):
        raise ValueError("replaceMetricIds contains a duplicate or unknown metric")
    replaced_weight = sum(base_by_id[item]["weight"] for item in replacements)
    if replaced_weight != custom_weight:
        raise ValueError("custom specialized weight must equal replaced metric weight")
    result = [item for item in base if item["id"] not in replacements] + custom
    ids = [item["id"] for item in result]
    if len(ids) != len(set(ids)) or sum(item["weight"] for item in result) != 20:
        raise ValueError("specialized metrics must have unique IDs and total 20")
    return result


def valid_identity(value: str) -> bool:
    return bool(value.strip()) and not re.search(r"[\r\n]", value)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game-id", required=True)
    parser.add_argument("--stage", required=True, choices=sorted(STAGES))
    parser.add_argument("--genre", required=True, choices=sorted(GENRE_ITEMS))
    parser.add_argument("--gdd-revision", required=True)
    parser.add_argument("--build-hash", required=True)
    parser.add_argument("--locked-at", required=True)
    parser.add_argument("--specialized-config", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()

    try:
        for value in (args.game_id, args.gdd_revision, args.build_hash, args.locked_at):
            if not valid_identity(value):
                raise ValueError("profile identity values must be non-empty single-line strings")
        general = [dict(item) for item in GENERAL_METRICS]
        specialized = specialized_metrics(args.genre)
        if args.specialized_config:
            specialized = apply_customization(specialized, load_json(args.specialized_config))
        if sum(item["weight"] for item in general) != 80 or sum(item["weight"] for item in specialized) != 20:
            raise ValueError("profile weights must total 80 general and 20 specialized")
        profile = {
            "version": 1,
            "profileId": f"{args.game_id}-{args.stage}-v1",
            "gameId": args.game_id,
            "stage": args.stage,
            "genre": args.genre,
            "gddRevision": args.gdd_revision,
            "buildHash": args.build_hash,
            "lockedAt": args.locked_at,
            "subjectiveWeight": 0.2,
            "thresholds": THRESHOLDS,
            "generalMetrics": general,
            "specializedMetrics": specialized,
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(profile, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    except (OSError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, "profileId": profile["profileId"], "output": str(args.output)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
