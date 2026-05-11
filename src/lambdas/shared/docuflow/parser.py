from __future__ import annotations

import re
from statistics import mean
from typing import Any

KNOWN_FIELD_ALIASES = {
    "vendor_name": {"vendor", "vendor_name", "vendor name", "supplier", "company"},
    "document_date": {"date", "document_date", "document date", "invoice date"},
    "total_amount": {"total", "total_amount", "total amount", "amount due", "invoice total"},
    "address": {"address", "mailing address", "service address"},
    "phone": {"phone", "phone number", "telephone"},
    "email": {"email", "email address"},
    "parcel_id": {"parcel id", "parcel number", "apn", "assessor parcel number"},
    "case_number": {"case number", "case no", "claim number", "file number"},
    "invoice_number": {"invoice number", "invoice no", "invoice #"},
}

ALIAS_TO_FIELD = {
    alias: field_name for field_name, aliases in KNOWN_FIELD_ALIASES.items() for alias in aliases
}


def normalize_key(value: str) -> str:
    normalized = value.lower().strip()
    normalized = re.sub(r"[:#]+$", "", normalized)
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


def canonical_field_name(key: str) -> str:
    normalized = normalize_key(key)
    if normalized in ALIAS_TO_FIELD:
        return ALIAS_TO_FIELD[normalized]
    return normalized.replace(" ", "_")


def _relationships(block: dict[str, Any], relationship_type: str) -> list[str]:
    ids: list[str] = []
    for relationship in block.get("Relationships", []):
        if relationship.get("Type") == relationship_type:
            ids.extend(relationship.get("Ids", []))
    return ids


def _text_and_confidence(
    block: dict[str, Any], blocks_by_id: dict[str, dict[str, Any]]
) -> tuple[str, float]:
    words: list[str] = []
    confidences: list[float] = []

    for child_id in _relationships(block, "CHILD"):
        child = blocks_by_id.get(child_id)
        if not child:
            continue
        block_type = child.get("BlockType")
        if block_type == "WORD":
            words.append(child.get("Text", ""))
            confidences.append(float(child.get("Confidence", block.get("Confidence", 0))))
        elif block_type == "SELECTION_ELEMENT" and child.get("SelectionStatus") == "SELECTED":
            words.append("selected")
            confidences.append(float(child.get("Confidence", block.get("Confidence", 0))))

    text = " ".join(word for word in words if word).strip()
    confidence = mean(confidences) if confidences else float(block.get("Confidence", 0))
    return text, confidence


def _value_block_for_key(
    key_block: dict[str, Any], blocks_by_id: dict[str, dict[str, Any]]
) -> dict[str, Any] | None:
    for value_id in _relationships(key_block, "VALUE"):
        value_block = blocks_by_id.get(value_id)
        if value_block:
            return value_block
    return None


def extract_key_values(textract_response: dict[str, Any]) -> dict[str, dict[str, Any]]:
    blocks = textract_response.get("Blocks", [])
    blocks_by_id = {block["Id"]: block for block in blocks if "Id" in block}
    extracted: dict[str, dict[str, Any]] = {}

    for block in blocks:
        if block.get("BlockType") != "KEY_VALUE_SET" or "KEY" not in block.get("EntityTypes", []):
            continue

        key_text, key_confidence = _text_and_confidence(block, blocks_by_id)
        if not key_text:
            continue

        value_block = _value_block_for_key(block, blocks_by_id)
        if not value_block:
            continue

        value_text, value_confidence = _text_and_confidence(value_block, blocks_by_id)
        normalized_key = normalize_key(key_text)
        confidence = round(min(key_confidence, value_confidence), 2)
        extracted[normalized_key] = {
            "key": key_text,
            "value": value_text,
            "confidence": confidence,
        }

    return extracted


def parse_textract_response(textract_response: dict[str, Any]) -> dict[str, Any]:
    key_values = extract_key_values(textract_response)
    fields: dict[str, dict[str, Any]] = {}

    for normalized_key, item in key_values.items():
        field_name = canonical_field_name(normalized_key)
        candidate = {
            "value": item["value"],
            "confidence": item["confidence"],
            "source_key": item["key"],
        }
        existing = fields.get(field_name)
        if not existing or candidate["confidence"] > existing["confidence"]:
            fields[field_name] = candidate

    confidences = [field["confidence"] for field in fields.values()]
    average_confidence = round(mean(confidences), 2) if confidences else 0.0

    return {
        "fields": fields,
        "key_values": key_values,
        "tables": [],
        "metrics": {
            "field_count": len(fields),
            "generic_key_value_count": len(key_values),
            "average_field_confidence": average_confidence,
        },
    }
