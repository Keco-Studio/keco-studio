#!/usr/bin/env python3
"""Build a deterministic Godot 4 SpriteFrames resource from verified sheets."""

from __future__ import annotations

import argparse
import json
import os
import re
import struct
import sys
import tempfile
from pathlib import Path


NAME_RE = re.compile(r"^[A-Za-z0-9_-]+$")
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def png_dimensions(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if len(data) < 24 or data[:8] != PNG_SIGNATURE or data[12:16] != b"IHDR":
        raise ValueError(f"invalid PNG header: {path}")
    width, height = struct.unpack(">II", data[16:24])
    if not width or not height:
        raise ValueError(f"PNG dimensions must be positive: {path}")
    return width, height


def godot_string(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def safe_res_path(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.startswith("res://") or ".." in Path(value).parts:
        raise ValueError(f"{label} must be a safe res:// path: {value!r}")
    return value


def parse_manifest(path: Path) -> tuple[str, list[dict]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid manifest: {exc}") from exc
    if data.get("version") != 1 or not isinstance(data.get("animations"), list) or not data["animations"]:
        raise ValueError("manifest requires version 1 and a non-empty animations array")
    resource_path = safe_res_path(data.get("resourcePath"), "resourcePath")
    seen: set[str] = set()
    # A sheet reused by several animations must resolve to one texture, so the
    # geometry recorded for it has to agree everywhere it appears.
    sheet_geometry: dict[str, tuple[int, int]] = {}
    for animation in data["animations"]:
        required = ("name", "sheetPath", "sheetFile", "frameWidth", "frameHeight", "frameCount", "fps", "loop")
        if not all(key in animation for key in required):
            raise ValueError("each animation requires name, sheetPath, sheetFile, frameWidth, frameHeight, frameCount, fps, and loop")
        name = animation["name"]
        if not isinstance(name, str) or not NAME_RE.fullmatch(name) or name in seen:
            raise ValueError(f"animation names must be unique and use letters, numbers, _ or -: {name!r}")
        seen.add(name)
        sheet_path = safe_res_path(animation["sheetPath"], "sheetPath")
        if any(not isinstance(animation[key], int) or isinstance(animation[key], bool) or animation[key] <= 0 for key in ("frameWidth", "frameHeight", "frameCount")):
            raise ValueError(f"frame dimensions and count must be positive integers: {name}")
        if not isinstance(animation["fps"], (int, float)) or isinstance(animation["fps"], bool) or animation["fps"] <= 0:
            raise ValueError(f"fps must be positive: {name}")
        if not isinstance(animation["loop"], bool):
            raise ValueError(f"loop must be a boolean: {name}")
        sheet_file = Path(animation["sheetFile"])
        if not sheet_file.is_file():
            raise ValueError(f"sheetFile does not exist: {sheet_file}")
        width, height = png_dimensions(sheet_file)
        expected = (animation["frameWidth"] * animation["frameCount"], animation["frameHeight"])
        if (width, height) != expected:
            raise ValueError(f"frame geometry mismatch for {name}: expected {expected[0]}x{expected[1]}, got {width}x{height}")
        previous = sheet_geometry.setdefault(sheet_path, (width, height))
        if previous != (width, height):
            raise ValueError(f"sheetPath {sheet_path} is declared with conflicting dimensions")
    return resource_path, data["animations"]


def build_resource(animations: list[dict]) -> str:
    # One ext_resource per distinct spritesheet, in first-seen order, so two
    # animations sharing a sheet reference the same Texture2D.
    sheet_ids: dict[str, str] = {}
    for animation in animations:
        sheet_ids.setdefault(animation["sheetPath"], f"sheet_{len(sheet_ids)}")
    atlas_count = sum(animation["frameCount"] for animation in animations)
    lines = [f"[gd_resource type=\"SpriteFrames\" load_steps={len(sheet_ids) + atlas_count + 1} format=3]", ""]
    for sheet_path, sheet_id in sheet_ids.items():
        lines.append(f"[ext_resource type=\"Texture2D\" path=\"{godot_string(sheet_path)}\" id=\"{sheet_id}\"]")
    lines.append("")
    for animation in animations:
        name = animation["name"]
        for frame in range(animation["frameCount"]):
            lines.extend([
                f"[sub_resource type=\"AtlasTexture\" id=\"AtlasTexture_{name}_{frame}\"]",
                f"atlas = ExtResource(\"{sheet_ids[animation['sheetPath']]}\")",
                f"region = Rect2({frame * animation['frameWidth']}, 0, {animation['frameWidth']}, {animation['frameHeight']})",
                "",
            ])
    lines.append("[resource]")
    animation_values = []
    for animation in animations:
        name = animation["name"]
        frames = ", ".join(
            f'{{"duration": 1.0, "texture": SubResource("AtlasTexture_{name}_{frame}")}}'
            for frame in range(animation["frameCount"])
        )
        animation_values.append(
            f'{{"frames": [{frames}], "loop": {str(animation["loop"]).lower()}, "name": &"{godot_string(name)}", "speed": {animation["fps"]:g}}}'
        )
    lines.append("animations = [" + ", ".join(animation_values) + "]")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        resource_path, animations = parse_manifest(args.manifest)
        # Bind the manifest's declared res:// identity to the file actually
        # written, so a materialized resource cannot silently land elsewhere.
        if args.output.name != Path(resource_path).name:
            raise ValueError(f"--output must be named {Path(resource_path).name} to match resourcePath {resource_path}")
        content = build_resource(animations)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=args.output.parent, delete=False) as handle:
            handle.write(content)
            temporary = Path(handle.name)
        os.replace(temporary, args.output)
    except (OSError, ValueError) as exc:
        print(f"spriteframes build failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({
        "ok": True,
        "animationCount": len(animations),
        "output": str(args.output),
        "resourcePath": resource_path,
        "sheetCount": len({animation["sheetPath"] for animation in animations}),
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
