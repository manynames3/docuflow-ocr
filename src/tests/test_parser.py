from __future__ import annotations

import json
from pathlib import Path

from docuflow.parser import canonical_field_name, parse_textract_response

FIXTURE = Path(__file__).parent / "fixtures" / "invoice_textract.json"


def load_fixture() -> dict:
    return json.loads(FIXTURE.read_text())


def test_canonical_field_name_maps_common_aliases() -> None:
    assert canonical_field_name("Vendor Name") == "vendor_name"
    assert canonical_field_name("Invoice Date") == "document_date"
    assert canonical_field_name("Amount Due") == "total_amount"
    assert canonical_field_name("Case No.") == "case_number"


def test_parse_textract_response_extracts_normalized_fields() -> None:
    parsed = parse_textract_response(load_fixture())

    assert parsed["fields"]["vendor_name"]["value"] == "Acme Services"
    assert parsed["fields"]["document_date"]["value"] == "2026-05-01"
    assert parsed["fields"]["total_amount"]["value"] == "$421.19"
    assert parsed["fields"]["email"]["value"] == "billing@example.com"
    assert parsed["fields"]["case_number"]["value"] == "CASE-1001"
    assert parsed["metrics"]["field_count"] == 5
    assert parsed["metrics"]["average_field_confidence"] > 90


def test_parse_textract_response_keeps_generic_key_values() -> None:
    parsed = parse_textract_response(load_fixture())

    assert parsed["key_values"]["vendor name"]["key"] == "Vendor Name"
    assert parsed["key_values"]["total amount"]["confidence"] == 95.0
