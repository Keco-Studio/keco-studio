#!/usr/bin/env python3
"""Export normalized Keco data as a deterministic Godot JSON snapshot."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
from typing import Any


KEY_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
DATA_TYPES = {
    "string",
    "string_array",
    "int",
    "int_array",
    "float",
    "float_array",
    "boolean",
    "enum",
    "date",
    "reference",
    "image",
}


class SnapshotError(ValueError):
    """Raised when normalized snapshot input violates the export contract."""


def canonical_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _mapping(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SnapshotError(f"{label} must be an object")
    return value


def _array(value: Any, label: str) -> list[Any]:
    if not isinstance(value, list):
        raise SnapshotError(f"{label} must be an array")
    return value


def _string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise SnapshotError(f"{label} must be a non-empty string")
    return value


def _key(value: Any, label: str) -> str:
    key = _string(value, label)
    if not KEY_PATTERN.fullmatch(key):
        raise SnapshotError(f"invalid {label}: {key!r}")
    return key


def _unique(items: list[dict[str, Any]], property_name: str, label: str) -> None:
    seen: set[str] = set()
    for item in items:
        value = item[property_name]
        if value in seen:
            raise SnapshotError(f"duplicate {label}: {value}")
        seen.add(value)


def _normalize_sources(value: Any) -> dict[str, list[dict[str, Any]]]:
    sources = _mapping(value, "sources")
    documents: list[dict[str, Any]] = []
    for index, raw in enumerate(_array(sources.get("documents"), "sources.documents")):
        item = _mapping(raw, f"sources.documents[{index}]")
        epoch = item.get("epoch")
        revision = item.get("revision")
        if not isinstance(epoch, int) or isinstance(epoch, bool) or epoch < 0:
            raise SnapshotError(f"sources.documents[{index}].epoch must be a non-negative integer")
        if not isinstance(revision, int) or isinstance(revision, bool) or revision < 0:
            raise SnapshotError(f"sources.documents[{index}].revision must be a non-negative integer")
        documents.append(
            {
                "epoch": epoch,
                "id": _string(item.get("id"), f"sources.documents[{index}].id"),
                "name": _string(item.get("name"), f"sources.documents[{index}].name"),
                "revision": revision,
            }
        )
    _unique(documents, "id", "source document id")

    tables: list[dict[str, Any]] = []
    for index, raw in enumerate(_array(sources.get("tables"), "sources.tables")):
        item = _mapping(raw, f"sources.tables[{index}]")
        tables.append(
            {
                "id": _string(item.get("id"), f"sources.tables[{index}].id"),
                "name": _string(item.get("name"), f"sources.tables[{index}].name"),
                "updatedAt": _string(item.get("updatedAt"), f"sources.tables[{index}].updatedAt"),
            }
        )
    _unique(tables, "id", "source table id")
    return {
        "documents": sorted(documents, key=lambda item: item["id"]),
        "tables": sorted(tables, key=lambda item: item["id"]),
    }


def _normalize_field(raw: Any, table_key: str, index: int) -> dict[str, Any]:
    item = _mapping(raw, f"table {table_key} field {index}")
    data_type = _string(item.get("dataType"), f"table {table_key} field dataType")
    if data_type not in DATA_TYPES:
        raise SnapshotError(f"unsupported data type {data_type!r} in table {table_key}")
    required = item.get("required")
    if not isinstance(required, bool):
        raise SnapshotError(f"table {table_key} field required must be boolean")
    field = {
        "dataType": data_type,
        "id": _string(item.get("id"), f"table {table_key} field id"),
        "key": _key(item.get("key"), "field key"),
        "label": _string(item.get("label"), f"table {table_key} field label"),
        "required": required,
    }
    if "description" in item and item["description"] is not None:
        field["description"] = _string(item["description"], f"table {table_key} field description")
    if data_type == "enum":
        options = _array(item.get("enumOptions"), f"table {table_key} enumOptions")
        if not options:
            raise SnapshotError(f"table {table_key} enumOptions must not be empty")
        normalized_options = [_string(option, f"table {table_key} enum option") for option in options]
        if len(set(normalized_options)) != len(normalized_options):
            raise SnapshotError(f"duplicate enum option in table {table_key}")
        field["enumOptions"] = normalized_options
    elif "enumOptions" in item:
        raise SnapshotError(f"enumOptions is only valid for enum fields in table {table_key}")
    if data_type == "reference":
        field["targetTableKey"] = _key(item.get("targetTableKey"), "target table key")
    elif "targetTableKey" in item:
        raise SnapshotError(f"targetTableKey is only valid for reference fields in table {table_key}")
    return field


def _normalize_scalar(value: Any, field: dict[str, Any], location: str) -> Any:
    data_type = field["dataType"]
    if data_type in {"string", "date"}:
        if not isinstance(value, str):
            raise SnapshotError(f"{location} must be a string")
    elif data_type == "string_array":
        if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
            raise SnapshotError(f"{location} must be an array of strings")
    elif data_type == "int":
        if not isinstance(value, int) or isinstance(value, bool):
            raise SnapshotError(f"{location} must be an integer")
    elif data_type == "int_array":
        if not isinstance(value, list) or any(not isinstance(item, int) or isinstance(item, bool) for item in value):
            raise SnapshotError(f"{location} must be an array of integers")
    elif data_type == "float":
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise SnapshotError(f"{location} must be a number")
        value = float(value)
    elif data_type == "float_array":
        if not isinstance(value, list) or any(not isinstance(item, (int, float)) or isinstance(item, bool) for item in value):
            raise SnapshotError(f"{location} must be an array of numbers")
        value = [float(item) for item in value]
    elif data_type == "boolean":
        if not isinstance(value, bool):
            raise SnapshotError(f"{location} must be a boolean")
    elif data_type == "enum":
        if not isinstance(value, str) or value not in field["enumOptions"]:
            raise SnapshotError(f"{location} must be one of the field enumOptions")
    elif data_type == "image":
        if not isinstance(value, (str, dict)):
            raise SnapshotError(f"{location} must be an image string or object")
    elif data_type == "reference":
        reference = _mapping(value, location)
        target_table_key = _key(reference.get("targetTableKey"), "target table key")
        if target_table_key != field["targetTableKey"]:
            raise SnapshotError(f"{location} targets {target_table_key}, expected {field['targetTableKey']}")
        target_rows = [_key(item, "target row key") for item in _array(reference.get("targetRowKeys"), f"{location}.targetRowKeys")]
        if len(set(target_rows)) != len(target_rows):
            raise SnapshotError(f"duplicate target row key in {location}")
        value = {"targetRowKeys": sorted(target_rows), "targetTableKey": target_table_key}
    return value


def _normalize_table(raw: Any, index: int) -> dict[str, Any]:
    item = _mapping(raw, f"tables[{index}]")
    table_key = _key(item.get("key"), "table key")
    fields = [_normalize_field(field, table_key, field_index) for field_index, field in enumerate(_array(item.get("fields"), f"table {table_key} fields"))]
    _unique(fields, "key", f"field key in table {table_key}")
    _unique(fields, "id", f"field id in table {table_key}")
    fields_by_key = {field["key"]: field for field in fields}

    rows: list[dict[str, Any]] = []
    for row_index, raw_row in enumerate(_array(item.get("rows"), f"table {table_key} rows")):
        row = _mapping(raw_row, f"table {table_key} row {row_index}")
        row_key = _key(row.get("key"), "row key")
        raw_values = _mapping(row.get("values"), f"table {table_key} row {row_key} values")
        unknown_fields = sorted(set(raw_values) - set(fields_by_key))
        if unknown_fields:
            raise SnapshotError(f"unknown field keys in table {table_key} row {row_key}: {unknown_fields}")
        missing_required = sorted(
            field_key
            for field_key, field in fields_by_key.items()
            if field["required"] and field_key not in raw_values
        )
        if missing_required:
            raise SnapshotError(f"missing required fields in table {table_key} row {row_key}: {missing_required}")
        values = {
            field_key: _normalize_scalar(
                raw_values[field_key],
                fields_by_key[field_key],
                f"table {table_key} row {row_key} field {field_key}",
            )
            for field_key in sorted(raw_values)
        }
        rows.append(
            {
                "id": _string(row.get("id"), f"table {table_key} row {row_key} id"),
                "key": row_key,
                "values": values,
            }
        )
    _unique(rows, "key", f"row key in table {table_key}")
    _unique(rows, "id", f"row id in table {table_key}")

    table = {
        "description": item.get("description"),
        "fields": sorted(fields, key=lambda field: field["key"]),
        "id": _string(item.get("id"), f"table {table_key} id"),
        "key": table_key,
        "name": _string(item.get("name"), f"table {table_key} name"),
        "rows": sorted(rows, key=lambda row: row["key"]),
        "updatedAt": _string(item.get("updatedAt"), f"table {table_key} updatedAt"),
    }
    if table["description"] is not None and not isinstance(table["description"], str):
        raise SnapshotError(f"table {table_key} description must be a string or null")
    return table


def normalize_source(value: Any) -> dict[str, Any]:
    source = _mapping(value, "source input")
    schema_version = source.get("schemaVersion")
    if not isinstance(schema_version, int) or isinstance(schema_version, bool) or schema_version < 1:
        raise SnapshotError("schemaVersion must be a positive integer")
    project = _mapping(source.get("project"), "project")
    normalized_project = {
        "id": _string(project.get("id"), "project.id"),
        "name": _string(project.get("name"), "project.name"),
    }
    tables = [_normalize_table(table, index) for index, table in enumerate(_array(source.get("tables"), "tables"))]
    _unique(tables, "key", "table key")
    _unique(tables, "id", "table id")
    tables = sorted(tables, key=lambda table: table["key"])

    table_rows = {table["key"]: {row["key"] for row in table["rows"]} for table in tables}
    for table in tables:
        for row in table["rows"]:
            for field_key, value_item in row["values"].items():
                field = next(field for field in table["fields"] if field["key"] == field_key)
                if field["dataType"] != "reference":
                    continue
                target_table_key = value_item["targetTableKey"]
                if target_table_key not in table_rows:
                    raise SnapshotError(f"unknown target table key {target_table_key} in table {table['key']} row {row['key']}")
                for target_row_key in value_item["targetRowKeys"]:
                    if target_row_key not in table_rows[target_table_key]:
                        raise SnapshotError(
                            f"unknown target row key {target_row_key} in table {table['key']} row {row['key']}"
                        )

    sources = _normalize_sources(source.get("sources"))
    source_tables = {table["id"]: table for table in sources["tables"]}
    for table in tables:
        source_table = source_tables.get(table["id"])
        if source_table is None:
            raise SnapshotError(f"table {table['key']} is missing from sources.tables")
        if source_table["updatedAt"] != table["updatedAt"]:
            raise SnapshotError(f"table {table['key']} updatedAt does not match sources.tables")

    return {
        "capturedAt": _string(source.get("capturedAt"), "capturedAt"),
        "project": normalized_project,
        "schemaVersion": schema_version,
        "sources": sources,
        "tables": tables,
    }


def build_snapshot(value: Any) -> tuple[dict[str, bytes], dict[str, Any]]:
    source = normalize_source(value)
    files: dict[str, bytes] = {}
    table_entries: list[dict[str, Any]] = []
    for table in source["tables"]:
        relative_path = f"tables/{table['key']}.json"
        payload = {
            "fields": table["fields"],
            "rows": table["rows"],
            "schemaVersion": source["schemaVersion"],
            "table": {
                "description": table["description"],
                "id": table["id"],
                "key": table["key"],
                "name": table["name"],
                "updatedAt": table["updatedAt"],
            },
        }
        content = canonical_bytes(payload)
        files[relative_path] = content
        table_entries.append(
            {
                "fieldCount": len(table["fields"]),
                "key": table["key"],
                "path": relative_path,
                "rowCount": len(table["rows"]),
                "sha256": sha256_bytes(content),
                "sourceTableId": table["id"],
                "sourceUpdatedAt": table["updatedAt"],
            }
        )
    aggregate = sha256_bytes(
        canonical_bytes([{"path": item["path"], "sha256": item["sha256"]} for item in table_entries])
    )
    manifest = {
        "aggregateSha256": aggregate,
        "capturedAt": source["capturedAt"],
        "project": source["project"],
        "schemaVersion": source["schemaVersion"],
        "sourceInputSha256": sha256_bytes(canonical_bytes(source)),
        "sources": source["sources"],
        "tables": table_entries,
    }
    return files, manifest


def _safe_output_path(value: str) -> Path:
    output = Path(value).expanduser().resolve()
    if output == Path(output.anchor) or output == Path.home().resolve():
        raise SnapshotError(f"refusing broad output directory: {output}")
    return output


def write_snapshot(output: Path, files: dict[str, bytes], manifest: dict[str, Any]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{output.name}.staging-", dir=output.parent))
    backup: Path | None = None
    try:
        for relative_path, content in files.items():
            destination = staging / relative_path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
        (staging / "manifest.json").write_bytes(canonical_bytes(manifest))
        if output.exists():
            backup = Path(tempfile.mkdtemp(prefix=f".{output.name}.backup-", dir=output.parent))
            backup.rmdir()
            os.replace(output, backup)
        try:
            os.replace(staging, output)
        except Exception:
            if backup is not None and backup.exists() and not output.exists():
                os.replace(backup, output)
            raise
        if backup is not None and backup.exists():
            shutil.rmtree(backup)
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def _load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SnapshotError(f"cannot read JSON input {path}: {error}") from error


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Normalized Keco source JSON")
    parser.add_argument("--output-dir", required=True, help="Dedicated generated snapshot directory")
    args = parser.parse_args(argv)
    try:
        files, manifest = build_snapshot(_load_json(Path(args.input)))
        output = _safe_output_path(args.output_dir)
        write_snapshot(output, files, manifest)
        print(json.dumps({"aggregateSha256": manifest["aggregateSha256"], "ok": True, "tableCount": len(files)}))
        return 0
    except (SnapshotError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
