from __future__ import annotations

from statistics import mean
from typing import Any


def required_field_list(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def score_extraction(
    parsed: dict[str, Any],
    threshold: float = 85.0,
    required_fields: list[str] | tuple[str, ...] | None = None,
) -> dict[str, Any]:
    fields = parsed.get("fields", {})
    required = list(required_fields or [])
    confidences = [
        float(field.get("confidence", 0))
        for field in fields.values()
        if field.get("value") not in (None, "")
    ]
    average_confidence = round(mean(confidences), 2) if confidences else 0.0

    missing_required = [
        field_name
        for field_name in required
        if not fields.get(field_name) or fields[field_name].get("value") in (None, "")
    ]
    completeness = 1.0
    if required:
        completeness = (len(required) - len(missing_required)) / len(required)

    score = round((average_confidence * 0.8) + (completeness * 100 * 0.2), 2)
    reasons: list[str] = []
    if not fields:
        reasons.append("no_fields_extracted")
    if average_confidence < threshold:
        reasons.append("average_confidence_below_threshold")
    if missing_required:
        reasons.append("missing_required_fields")

    status = (
        "COMPLETED" if fields and not missing_required and score >= threshold else "NEEDS_REVIEW"
    )
    return {
        "status": status,
        "score": score,
        "average_confidence": average_confidence,
        "threshold": threshold,
        "missing_required_fields": missing_required,
        "review_reasons": reasons,
    }


def status_for_review_decision(decision: str) -> str:
    normalized = decision.strip().upper()
    if normalized in {"APPROVE", "APPROVED"}:
        return "APPROVED"
    if normalized in {"REJECT", "REJECTED"}:
        return "REJECTED"
    raise ValueError("decision must be APPROVE or REJECT")
