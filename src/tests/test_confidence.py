from __future__ import annotations

from docuflow.confidence import score_extraction


def test_high_confidence_document_completes() -> None:
    parsed = {
        "fields": {
            "vendor_name": {"value": "Acme", "confidence": 98.0},
            "document_date": {"value": "2026-05-01", "confidence": 97.0},
            "total_amount": {"value": "$421.19", "confidence": 96.0},
        }
    }

    result = score_extraction(
        parsed,
        threshold=85,
        required_fields=["vendor_name", "document_date", "total_amount"],
    )

    assert result["status"] == "COMPLETED"
    assert result["score"] >= 85
    assert result["missing_required_fields"] == []


def test_low_confidence_document_goes_to_review() -> None:
    parsed = {
        "fields": {
            "vendor_name": {"value": "Acme", "confidence": 72.0},
            "document_date": {"value": "2026-05-01", "confidence": 70.0},
            "total_amount": {"value": "$421.19", "confidence": 65.0},
        }
    }

    result = score_extraction(
        parsed,
        threshold=85,
        required_fields=["vendor_name", "document_date", "total_amount"],
    )

    assert result["status"] == "NEEDS_REVIEW"
    assert "average_confidence_below_threshold" in result["review_reasons"]


def test_missing_required_field_goes_to_review() -> None:
    parsed = {
        "fields": {
            "vendor_name": {"value": "Acme", "confidence": 98.0},
            "total_amount": {"value": "$421.19", "confidence": 96.0},
        }
    }

    result = score_extraction(
        parsed,
        threshold=85,
        required_fields=["vendor_name", "document_date", "total_amount"],
    )

    assert result["status"] == "NEEDS_REVIEW"
    assert result["missing_required_fields"] == ["document_date"]
