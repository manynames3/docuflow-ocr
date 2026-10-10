from __future__ import annotations

import csv
import hashlib
import io
import json
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError
from create_upload import handler as upload_handler
from docuflow.documents import validate_document
from failure_handler import handler as failure_handler
from parse_and_score import handler as parse_handler
from pypdf import PdfWriter
from review_api import handler as review_handler
from start_processing import handler as start_handler
from textract_get_results import handler as textract_results_handler
from textract_start import handler as textract_start_handler
from validate_input import handler as validate_handler


def event(
    route: str,
    *,
    owner: str = "tenant-a",
    email: str = "a@example.test",
    job_id: str = "job-1",
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    method, path = route.split(" ", 1)
    return {
        "routeKey": route,
        "httpMethod": method,
        "pathParameters": {"job_id": job_id},
        "headers": {},
        "body": json.dumps(body or {}),
        "requestContext": {"authorizer": {"jwt": {"claims": {"sub": owner, "email": email}}}},
    }


def response_body(response: dict[str, Any]) -> dict[str, Any]:
    return json.loads(response["body"])


def make_pdf(pages: int = 1) -> bytes:
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=612, height=792)
    content = io.BytesIO()
    writer.write(content)
    return content.getvalue()


def test_document_validation_checks_signatures_and_pdf_page_limit() -> None:
    pdf = make_pdf(pages=2)
    assert validate_document("invoice.pdf", "application/pdf", pdf, max_pages=2) == 2
    with pytest.raises(ValueError, match="up to 1 pages"):
        validate_document("invoice.pdf", "application/pdf", pdf, max_pages=1)
    with pytest.raises(ValueError, match="valid PNG"):
        validate_document("invoice.png", "image/png", b"not an image", max_pages=25)
    with pytest.raises(ValueError, match="matching file type"):
        validate_document("invoice.pdf", "image/png", pdf, max_pages=25)


def test_upload_uses_verified_owner_and_idempotent_private_object_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    jobs = MagicMock()
    quotas = MagicMock()
    db = MagicMock()
    db.Table.side_effect = lambda name: {"jobs": jobs, "quotas": quotas}[name]
    storage = MagicMock()
    storage.generate_presigned_post.return_value = {
        "url": "https://s3.test",
        "fields": {"key": "x"},
    }
    monkeypatch.setattr(upload_handler, "dynamodb", db)
    monkeypatch.setattr(upload_handler, "s3", storage)
    monkeypatch.setenv("JOBS_TABLE", "jobs")
    monkeypatch.setenv("QUOTAS_TABLE", "quotas")
    monkeypatch.setenv("DOCUMENTS_BUCKET", "private-documents")

    request = event(
        "POST /uploads",
        body={
            "filename": "vendor-invoice.pdf",
            "content_type": "application/pdf",
            "file_size": 1024,
            "sha256": "a" * 64,
            "owner_id": "attacker-selected-owner",
        },
    )
    request["headers"] = {"Idempotency-Key": "4c8985e1-60b7-4e6b-b67a-000000000001"}
    result = upload_handler.lambda_handler(request, None)

    item = jobs.put_item.call_args.kwargs["Item"]
    assert result["statusCode"] == 201
    assert item["owner_id"] == "tenant-a"
    assert item["raw_s3_key"] == f"raw/tenant-a/{item['job_id']}/document"
    assert "vendor-invoice.pdf" not in item["raw_s3_key"]
    assert item["upload_sha256"] == "a" * 64
    assert quotas.update_item.call_args.kwargs["Key"]["quota_key"].startswith("tenant-a:")
    assert response_body(result)["upload_required"] is True
    assert {"x-amz-meta-sha256": "a" * 64} in storage.generate_presigned_post.call_args.kwargs[
        "Conditions"
    ]


def test_upload_retry_reuses_existing_job_without_consuming_quota_again(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    key = "4c8985e1-60b7-4e6b-b67a-000000000011"
    sha256 = "d" * 64
    jobs = MagicMock()
    jobs.put_item.side_effect = ClientError(
        {"Error": {"Code": "ConditionalCheckFailedException", "Message": "exists"}},
        "PutItem",
    )
    jobs.get_item.return_value = {
        "Item": {
            "owner_id": "tenant-a",
            "filename": "invoice.pdf",
            "content_type": "application/pdf",
            "content_length": 100,
            "upload_sha256": sha256,
            "status": "CREATED",
        }
    }
    quotas = MagicMock()
    db = MagicMock()
    db.Table.side_effect = lambda name: {"jobs": jobs, "quotas": quotas}[name]
    storage = MagicMock()
    storage.generate_presigned_post.return_value = {
        "url": "https://s3.test",
        "fields": {"key": "private"},
    }
    monkeypatch.setattr(upload_handler, "dynamodb", db)
    monkeypatch.setattr(upload_handler, "s3", storage)
    monkeypatch.setenv("JOBS_TABLE", "jobs")
    monkeypatch.setenv("QUOTAS_TABLE", "quotas")
    monkeypatch.setenv("DOCUMENTS_BUCKET", "private-documents")
    request = event(
        "POST /uploads",
        body={
            "filename": "invoice.pdf",
            "content_type": "application/pdf",
            "file_size": 100,
            "sha256": sha256,
        },
    )
    request["headers"] = {"idempotency-key": key}

    response = upload_handler.lambda_handler(request, None)

    assert response["statusCode"] == 200
    assert response_body(response)["upload_required"] is True
    jobs.get_item.assert_called_once()
    assert jobs.get_item.call_args.kwargs["ConsistentRead"] is True
    quotas.update_item.assert_not_called()


def test_resume_upload_skips_upload_when_matching_object_already_exists(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    jobs = MagicMock()
    jobs.get_item.return_value = {
        "Item": {
            "job_id": "job-1",
            "owner_id": "tenant-a",
            "filename": "invoice.png",
            "content_type": "image/png",
            "content_length": 100,
            "upload_sha256": "a" * 64,
            "status": "CREATED",
        }
    }
    db = MagicMock()
    db.Table.return_value = jobs
    storage = MagicMock()
    storage.head_object.return_value = {
        "ContentLength": 100,
        "ContentType": "image/png",
        "Metadata": {"sha256": "a" * 64},
    }
    monkeypatch.setattr(upload_handler, "dynamodb", db)
    monkeypatch.setattr(upload_handler, "s3", storage)
    monkeypatch.setenv("JOBS_TABLE", "jobs")
    monkeypatch.setenv("DOCUMENTS_BUCKET", "private-documents")

    response = upload_handler.lambda_handler(
        event("POST /jobs/{job_id}/upload-url", body={"sha256": "a" * 64}), None
    )

    assert response["statusCode"] == 200
    assert response_body(response)["upload_required"] is False
    assert jobs.get_item.call_args.kwargs["ConsistentRead"] is True
    storage.generate_presigned_post.assert_not_called()


def test_resume_upload_reissues_private_post_if_object_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    jobs = MagicMock()
    jobs.get_item.return_value = {
        "Item": {
            "job_id": "job-1",
            "owner_id": "tenant-a",
            "content_type": "image/png",
            "content_length": 100,
            "upload_sha256": "b" * 64,
            "status": "CREATED",
        }
    }
    db = MagicMock()
    db.Table.return_value = jobs
    storage = MagicMock()
    storage.head_object.side_effect = ClientError(
        {"Error": {"Code": "NoSuchKey", "Message": "missing"}}, "HeadObject"
    )
    storage.generate_presigned_post.return_value = {
        "url": "https://s3.test",
        "fields": {"key": "private"},
    }
    monkeypatch.setattr(upload_handler, "dynamodb", db)
    monkeypatch.setattr(upload_handler, "s3", storage)
    monkeypatch.setenv("JOBS_TABLE", "jobs")
    monkeypatch.setenv("DOCUMENTS_BUCKET", "private-documents")

    response = upload_handler.lambda_handler(
        event("POST /jobs/{job_id}/upload-url", body={"sha256": "b" * 64}), None
    )

    assert response["statusCode"] == 200
    assert response_body(response)["upload_required"] is True
    storage.generate_presigned_post.assert_called_once()
    assert {"x-amz-meta-sha256": "b" * 64} in storage.generate_presigned_post.call_args.kwargs[
        "Conditions"
    ]


@pytest.mark.parametrize(
    ("owner", "status", "stored_hash", "request_hash", "expected_status"),
    [
        ("tenant-b", "CREATED", "a" * 64, "a" * 64, 404),
        ("tenant-a", "PROCESSING", "a" * 64, "a" * 64, 200),
        ("tenant-a", "CREATED", "a" * 64, "b" * 64, 409),
        ("tenant-a", "DELETING", "a" * 64, "a" * 64, 409),
    ],
)
def test_resume_upload_rejects_wrong_owner_state_or_file(
    monkeypatch: pytest.MonkeyPatch,
    owner: str,
    status: str,
    stored_hash: str,
    request_hash: str,
    expected_status: int,
) -> None:
    jobs = MagicMock()
    jobs.get_item.return_value = {
        "Item": {
            "job_id": "job-1",
            "owner_id": "tenant-a",
            "status": status,
            "upload_sha256": stored_hash,
            "content_type": "image/png",
            "content_length": 100,
        }
    }
    db = MagicMock()
    db.Table.return_value = jobs
    storage = MagicMock()
    monkeypatch.setattr(upload_handler, "dynamodb", db)
    monkeypatch.setattr(upload_handler, "s3", storage)
    monkeypatch.setenv("JOBS_TABLE", "jobs")
    monkeypatch.setenv("DOCUMENTS_BUCKET", "private-documents")

    response = upload_handler.lambda_handler(
        event(
            "POST /jobs/{job_id}/upload-url",
            owner=owner,
            body={"sha256": request_hash},
        ),
        None,
    )

    assert response["statusCode"] == expected_status
    if owner == "tenant-a" and status == "CREATED" and request_hash != stored_hash:
        assert response_body(response)["code"] == "UPLOAD_CHECKSUM_MISMATCH"
    storage.head_object.assert_not_called()
    storage.generate_presigned_post.assert_not_called()


def test_upload_limit_returns_429_and_removes_unaccepted_job(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    jobs = MagicMock()
    quotas = MagicMock()
    quotas.update_item.side_effect = ClientError(
        {"Error": {"Code": "ConditionalCheckFailedException", "Message": "limit"}},
        "UpdateItem",
    )
    db = MagicMock()
    db.Table.side_effect = lambda name: {"jobs": jobs, "quotas": quotas}[name]
    monkeypatch.setattr(upload_handler, "dynamodb", db)
    monkeypatch.setattr(upload_handler, "s3", MagicMock())
    monkeypatch.setenv("JOBS_TABLE", "jobs")
    monkeypatch.setenv("QUOTAS_TABLE", "quotas")
    monkeypatch.setenv("DOCUMENTS_BUCKET", "private-documents")
    request = event(
        "POST /uploads",
        body={
            "filename": "invoice.pdf",
            "content_type": "application/pdf",
            "file_size": 100,
            "sha256": "c" * 64,
        },
    )
    request["headers"] = {"idempotency-key": "4c8985e1-60b7-4e6b-b67a-000000000002"}

    result = upload_handler.lambda_handler(request, None)

    assert result["statusCode"] == 429
    jobs.delete_item.assert_called_once()


def test_missing_identity_cannot_create_an_upload(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(upload_handler, "dynamodb", MagicMock())
    request = event(
        "POST /uploads",
        body={"filename": "invoice.pdf", "content_type": "application/pdf", "file_size": 100},
    )
    request["requestContext"] = {}
    request["headers"] = {"idempotency-key": "4c8985e1-60b7-4e6b-b67a-000000000003"}

    result = upload_handler.lambda_handler(request, None)

    assert result["statusCode"] == 401
    upload_handler.dynamodb.Table.assert_not_called()


def test_other_account_cannot_read_job_or_save_corrections(monkeypatch: pytest.MonkeyPatch) -> None:
    jobs = MagicMock()
    jobs.get_item.return_value = {
        "Item": {"job_id": "job-1", "owner_id": "tenant-a", "status": "NEEDS_REVIEW"}
    }
    db = MagicMock()
    db.Table.return_value = jobs
    monkeypatch.setattr(review_handler, "dynamodb", db)
    get_response = review_handler.lambda_handler(
        event("GET /jobs/{job_id}", owner="tenant-b"), None
    )
    patch_request = event(
        "PATCH /jobs/{job_id}/review",
        owner="tenant-b",
        body={"corrected_fields": {"total_amount": "999.00"}},
    )
    patch_response = review_handler.lambda_handler(patch_request, None)

    assert get_response["statusCode"] == 404
    assert patch_response["statusCode"] == 404
    jobs.update_item.assert_not_called()


def test_other_account_cannot_obtain_document_url_or_review_history(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    jobs = MagicMock()
    jobs.get_item.return_value = {
        "Item": {
            "job_id": "job-1",
            "owner_id": "tenant-a",
            "status": "NEEDS_REVIEW",
            "bucket": "private-documents",
            "raw_s3_key": "raw/tenant-a/job-1/document",
        }
    }
    db = MagicMock()
    db.Table.return_value = jobs
    storage = MagicMock()
    monkeypatch.setattr(review_handler, "dynamodb", db)
    monkeypatch.setattr(review_handler, "s3", storage)
    monkeypatch.setenv("JOBS_TABLE", "jobs")
    monkeypatch.setenv("AUDIT_TABLE", "audit")

    document = review_handler.lambda_handler(
        event("GET /jobs/{job_id}/document", owner="tenant-b"), None
    )
    history = review_handler.lambda_handler(
        event("GET /jobs/{job_id}/history", owner="tenant-b"), None
    )

    assert document["statusCode"] == history["statusCode"] == 404
    storage.head_object.assert_not_called()
    storage.generate_presigned_url.assert_not_called()
    assert db.Table.call_count == 2


def test_job_responses_do_not_expose_owner_or_storage_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    jobs = MagicMock()
    jobs.get_item.return_value = {
        "Item": {
            "job_id": "job-1",
            "owner_id": "tenant-a",
            "status": "NEEDS_REVIEW",
            "bucket": "private-documents",
            "raw_s3_key": "raw/tenant-a/job-1/document",
            "textract_s3_key": "textract/tenant-a/job-1/raw.json",
            "upload_sha256": "e" * 64,
        }
    }
    db = MagicMock()
    db.Table.return_value = jobs
    monkeypatch.setattr(review_handler, "dynamodb", db)
    monkeypatch.setenv("JOBS_TABLE", "jobs")

    response = review_handler.lambda_handler(event("GET /jobs/{job_id}"), None)
    job = response_body(response)["job"]

    assert response["statusCode"] == 200
    assert "owner_id" not in job
    assert "bucket" not in job and "raw_s3_key" not in job and "textract_s3_key" not in job
    assert "upload_sha256" not in job


def test_saved_corrections_are_audited_and_exported(monkeypatch: pytest.MonkeyPatch) -> None:
    jobs = MagicMock()
    jobs.get_item.return_value = {
        "Item": {
            "job_id": "job-1",
            "owner_id": "tenant-a",
            "status": "COMPLETED",
            "created_at": "2026-10-10T12:00:00Z",
            "parsed_fields": {
                "vendor_name": {"value": "Northstar"},
                "total_amount": {"value": "$100.00", "confidence": 73.0, "page": 2},
            },
            "corrected_fields": {"total_amount": "-1+cmd"},
        }
    }
    jobs.query.return_value = {
        "Items": [
            {
                "job_id": "job-1",
                "owner_id": "tenant-a",
                "status": "APPROVED",
                "created_at": "2026-10-10T12:00:00Z",
                "parsed_fields": {
                    "vendor_name": {"value": "Northstar"},
                    "total_amount": {"value": "$100.00"},
                },
                "corrected_fields": {"vendor_name": "=FORMULA()", "total_amount": "250.00"},
            }
        ]
    }
    audit = MagicMock()
    db = MagicMock()
    db.Table.side_effect = lambda name: {"jobs": jobs, "audit": audit}[name]
    monkeypatch.setattr(review_handler, "dynamodb", db)
    monkeypatch.setenv("JOBS_TABLE", "jobs")
    monkeypatch.setenv("AUDIT_TABLE", "audit")

    save_response = review_handler.lambda_handler(
        event(
            "PATCH /jobs/{job_id}/review",
            body={"corrected_fields": {"total_amount": "250.00"}},
        ),
        None,
    )
    export_response = review_handler.lambda_handler(event("GET /exports/invoices.csv"), None)
    rows = list(csv.DictReader(io.StringIO(export_response["body"])))
    audit_item = audit.put_item.call_args.kwargs["Item"]

    assert save_response["statusCode"] == 200
    assert jobs.update_item.call_args.kwargs["ConditionExpression"].startswith("owner_id = :owner")
    assert audit_item["details"]["changes"]["total_amount"] == {"from": "-1+cmd", "to": "250.00"}
    assert export_response["headers"]["content-disposition"].endswith('"docuflow-invoices.csv"')
    assert rows[0]["vendor_name"] == "'=FORMULA()"
    assert rows[0]["total_amount"] == "250.00"


def test_corrections_are_rejected_before_a_job_is_ready_for_review(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    jobs = MagicMock()
    jobs.get_item.return_value = {
        "Item": {"job_id": "job-1", "owner_id": "tenant-a", "status": "PROCESSING"}
    }
    db = MagicMock()
    db.Table.return_value = jobs
    monkeypatch.setattr(review_handler, "dynamodb", db)
    monkeypatch.setenv("JOBS_TABLE", "jobs")

    response = review_handler.lambda_handler(
        event(
            "PATCH /jobs/{job_id}/review",
            body={"corrected_fields": {"total_amount": "250.00"}},
        ),
        None,
    )

    assert response["statusCode"] == 409
    jobs.update_item.assert_not_called()


def test_export_is_header_only_when_customer_has_no_approved_invoices(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    jobs = MagicMock()
    jobs.query.return_value = {"Items": []}
    db = MagicMock()
    db.Table.return_value = jobs
    monkeypatch.setattr(review_handler, "dynamodb", db)
    monkeypatch.setenv("JOBS_TABLE", "jobs")

    response = review_handler.lambda_handler(event("GET /exports/invoices.csv"), None)

    assert response["statusCode"] == 200
    assert next(csv.reader(io.StringIO(response["body"]))) == [
        "vendor_name",
        "invoice_number",
        "document_date",
        "due_date",
        "total_amount",
        "currency",
        "status",
        "created_at",
    ]
    jobs.query.assert_called_once()


def test_export_excludes_completed_invoices_until_they_are_approved(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    jobs = MagicMock()
    jobs.query.return_value = {
        "Items": [
            {"job_id": "review", "status": "COMPLETED", "created_at": "a"},
            {
                "job_id": "approved",
                "status": "APPROVED",
                "created_at": "b",
                "corrected_fields": {"vendor_name": "Saved Vendor", "total_amount": "250.00"},
            },
        ]
    }
    db = MagicMock()
    db.Table.return_value = jobs
    monkeypatch.setattr(review_handler, "dynamodb", db)
    monkeypatch.setenv("JOBS_TABLE", "jobs")

    response = review_handler.lambda_handler(event("GET /exports/invoices.csv"), None)
    rows = list(csv.DictReader(io.StringIO(response["body"])))

    assert [row["status"] for row in rows] == ["APPROVED"]
    assert rows[0]["vendor_name"] == "Saved Vendor"


def test_delete_is_refused_while_processing(monkeypatch: pytest.MonkeyPatch) -> None:
    jobs = MagicMock()
    jobs.get_item.return_value = {
        "Item": {"job_id": "job-1", "owner_id": "tenant-a", "status": "PROCESSING"}
    }
    db = MagicMock()
    db.Table.return_value = jobs
    storage = MagicMock()
    monkeypatch.setattr(review_handler, "dynamodb", db)
    monkeypatch.setattr(review_handler, "s3", storage)

    response = review_handler.lambda_handler(event("DELETE /jobs/{job_id}"), None)

    assert response["statusCode"] == 409
    jobs.update_item.assert_not_called()
    storage.delete_objects.assert_not_called()


def test_delete_cleans_up_source_and_all_attempt_scoped_textract_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    jobs = MagicMock()
    jobs.get_item.return_value = {
        "Item": {
            "job_id": "job-1",
            "owner_id": "tenant-a",
            "status": "APPROVED",
            "bucket": "private-documents",
            "raw_s3_key": "raw/tenant-a/job-1/document",
        }
    }
    audit = MagicMock()
    audit.query.return_value = {"Items": []}
    db = MagicMock()
    db.Table.side_effect = lambda name: {"jobs": jobs, "audit": audit}[name]
    storage = MagicMock()
    storage.list_objects_v2.return_value = {
        "Contents": [
            {"Key": "textract/tenant-a/job-1/attempt-1/raw.json"},
            {"Key": "textract/tenant-a/job-1/attempt-2/raw.json"},
        ]
    }
    storage.delete_objects.return_value = {"Deleted": [], "Errors": []}
    monkeypatch.setattr(review_handler, "dynamodb", db)
    monkeypatch.setattr(review_handler, "s3", storage)
    monkeypatch.setenv("JOBS_TABLE", "jobs")
    monkeypatch.setenv("AUDIT_TABLE", "audit")

    response = review_handler.lambda_handler(event("DELETE /jobs/{job_id}"), None)

    deleted_keys = [
        item["Key"] for item in storage.delete_objects.call_args.kwargs["Delete"]["Objects"]
    ]
    assert response["statusCode"] == 200
    assert set(deleted_keys) == {
        "raw/tenant-a/job-1/document",
        "textract/tenant-a/job-1/attempt-1/raw.json",
        "textract/tenant-a/job-1/attempt-2/raw.json",
    }
    jobs.delete_item.assert_called_once()


def test_start_processing_does_not_reveal_or_start_another_accounts_job(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    jobs = MagicMock()
    jobs.get_item.return_value = {
        "Item": {
            "job_id": "job-1",
            "owner_id": "tenant-a",
            "status": "CREATED",
            "bucket": "private-documents",
            "raw_s3_key": "raw/tenant-a/job-1/document",
        }
    }
    db = MagicMock()
    db.Table.return_value = jobs
    monkeypatch.setattr(start_handler, "dynamodb", db)
    monkeypatch.setattr(start_handler, "sfn", MagicMock())
    response = start_handler.lambda_handler(
        event("POST /jobs/{job_id}/start", owner="tenant-b"), None
    )

    assert response["statusCode"] == 404
    jobs.update_item.assert_not_called()
    start_handler.sfn.start_execution.assert_not_called()


def test_start_processing_rejects_a_mismatched_uploaded_object(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    jobs = MagicMock()
    jobs.get_item.return_value = {
        "Item": {
            "job_id": "job-1",
            "owner_id": "tenant-a",
            "status": "CREATED",
            "bucket": "private-documents",
            "raw_s3_key": "raw/tenant-a/job-1/document",
            "content_type": "application/pdf",
            "content_length": 100,
        }
    }
    db = MagicMock()
    db.Table.return_value = jobs
    storage = MagicMock()
    storage.head_object.return_value = {"ContentLength": 101, "ContentType": "application/pdf"}
    monkeypatch.setattr(start_handler, "dynamodb", db)
    monkeypatch.setattr(start_handler, "boto3", MagicMock(client=lambda _: storage))
    monkeypatch.setattr(start_handler, "sfn", MagicMock())
    monkeypatch.setenv("JOBS_TABLE", "jobs")

    response = start_handler.lambda_handler(event("POST /jobs/{job_id}/start"), None)

    assert response["statusCode"] == 409
    jobs.update_item.assert_not_called()
    start_handler.sfn.start_execution.assert_not_called()


def test_validation_rejects_over_limit_pdf_before_workflow_progress(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pdf = make_pdf(pages=2)
    storage = MagicMock()
    storage.head_object.return_value = {"ContentLength": len(pdf), "ContentType": "application/pdf"}
    storage.get_object.return_value = {"Body": io.BytesIO(pdf)}
    jobs = MagicMock()
    jobs.get_item.return_value = {
        "Item": {
            "job_id": "job-1",
            "owner_id": "tenant-a",
            "content_length": len(pdf),
            "processing_attempt": 1,
        }
    }
    db = MagicMock()
    db.Table.return_value = jobs
    monkeypatch.setattr(validate_handler, "s3", storage)
    monkeypatch.setattr(validate_handler, "dynamodb", db)
    monkeypatch.setenv("JOBS_TABLE", "jobs")
    monkeypatch.setenv("MAX_DOCUMENT_PAGES", "1")
    payload = {
        "job_id": "job-1",
        "owner_id": "tenant-a",
        "bucket": "private-documents",
        "raw_s3_key": "raw/tenant-a/job-1/document",
        "filename": "invoice.pdf",
        "content_type": "application/pdf",
        "processing_attempt": 1,
    }

    with pytest.raises(validate_handler.InvalidDocumentError, match="up to 1 pages"):
        validate_handler.lambda_handler(payload, None)

    jobs.update_item.assert_not_called()


@pytest.mark.parametrize("matches_checksum", [True, False])
def test_validation_verifies_uploaded_bytes_against_selected_file_checksum(
    monkeypatch: pytest.MonkeyPatch,
    matches_checksum: bool,
) -> None:
    pdf = make_pdf()
    jobs = MagicMock()
    jobs.get_item.return_value = {
        "Item": {
            "job_id": "job-1",
            "owner_id": "tenant-a",
            "content_length": len(pdf),
            "processing_attempt": 1,
            "upload_sha256": hashlib.sha256(pdf).hexdigest() if matches_checksum else "0" * 64,
        }
    }
    db = MagicMock()
    db.Table.return_value = jobs
    storage = MagicMock()
    storage.head_object.return_value = {"ContentLength": len(pdf), "ContentType": "application/pdf"}
    storage.get_object.return_value = {"Body": io.BytesIO(pdf)}
    monkeypatch.setattr(validate_handler, "s3", storage)
    monkeypatch.setattr(validate_handler, "dynamodb", db)
    monkeypatch.setenv("JOBS_TABLE", "jobs")
    payload = {
        "job_id": "job-1",
        "owner_id": "tenant-a",
        "bucket": "private-documents",
        "raw_s3_key": "raw/tenant-a/job-1/document",
        "filename": "invoice.pdf",
        "content_type": "application/pdf",
        "processing_attempt": 1,
    }

    if matches_checksum:
        result = validate_handler.lambda_handler(payload, None)
        assert result["page_count"] == 1
        jobs.update_item.assert_called_once()
    else:
        with pytest.raises(
            validate_handler.InvalidDocumentError,
            match="does not match the selected invoice",
        ):
            validate_handler.lambda_handler(payload, None)
        jobs.update_item.assert_not_called()


def test_parse_and_score_is_scoped_to_the_current_processing_attempt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    jobs = MagicMock()
    db = MagicMock()
    db.Table.return_value = jobs
    storage = MagicMock()
    fixture = Path(__file__).parent / "fixtures" / "invoice_textract.json"
    storage.get_object.return_value = {"Body": io.BytesIO(fixture.read_bytes())}
    monkeypatch.setattr(parse_handler, "dynamodb", db)
    monkeypatch.setattr(parse_handler, "s3", storage)
    monkeypatch.setenv("JOBS_TABLE", "jobs")
    monkeypatch.setenv("DOCUMENTS_BUCKET", "private-documents")
    monkeypatch.setenv("REQUIRED_FIELDS", "vendor_name,total_amount")
    payload = {
        "job_id": "job-1",
        "owner_id": "tenant-a",
        "processing_attempt": 3,
        "textract_s3_key": "textract/tenant-a/job-1/raw.json",
    }

    result = parse_handler.lambda_handler(payload, None)

    condition = jobs.update_item.call_args.kwargs["ConditionExpression"]
    assert result["status"] == "COMPLETED"
    assert "processing_attempt = :attempt" in condition
    assert "#status = :processing" in condition


def test_textract_outputs_are_separated_by_processing_attempt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    textract = MagicMock()
    textract.get_document_analysis.return_value = {
        "JobStatus": "SUCCEEDED",
        "Blocks": [],
        "DocumentMetadata": {"Pages": 1},
    }
    storage = MagicMock()
    monkeypatch.setattr(textract_results_handler, "textract", textract)
    monkeypatch.setattr(textract_results_handler, "s3", storage)
    monkeypatch.setenv("DOCUMENTS_BUCKET", "private-documents")

    result = textract_results_handler.lambda_handler(
        {
            "textract_job_id": "textract-1",
            "owner_id": "tenant-a",
            "job_id": "job-1",
            "processing_attempt": 4,
        },
        None,
    )

    assert result["textract_s3_key"] == "textract/tenant-a/job-1/attempt-4/raw.json"
    assert storage.put_object.call_args.kwargs["Key"] == result["textract_s3_key"]


def test_textract_start_is_idempotent_per_processing_attempt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    textract = MagicMock()
    textract.start_document_analysis.return_value = {"JobId": "textract-job-1"}
    monkeypatch.setattr(textract_start_handler, "textract", textract)
    payload = {
        "job_id": "job-1",
        "owner_id": "tenant-a",
        "bucket": "private-documents",
        "raw_s3_key": "raw/tenant-a/job-1/document",
        "processing_attempt": 3,
    }

    result = textract_start_handler.lambda_handler(payload, None)

    assert result["textract_job_id"] == "textract-job-1"
    assert textract.start_document_analysis.call_args.kwargs["ClientRequestToken"] == "job-1-3"


def test_stale_failure_does_not_overwrite_a_new_processing_attempt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    jobs = MagicMock()
    jobs.update_item.side_effect = ClientError(
        {"Error": {"Code": "ConditionalCheckFailedException", "Message": "stale"}},
        "UpdateItem",
    )
    jobs.get_item.return_value = {
        "Item": {
            "job_id": "job-1",
            "owner_id": "tenant-a",
            "processing_attempt": 2,
            "status": "PROCESSING",
        }
    }
    db = MagicMock()
    db.Table.return_value = jobs
    queue = MagicMock()
    monkeypatch.setattr(failure_handler, "dynamodb", db)
    monkeypatch.setattr(failure_handler, "sqs", queue)
    monkeypatch.setenv("JOBS_TABLE", "jobs")
    monkeypatch.setenv("DLQ_URL", "https://sqs.test/dlq")

    result = failure_handler.lambda_handler(
        {
            "job_id": "job-1",
            "owner_id": "tenant-a",
            "processing_attempt": 1,
            "error": {"Error": "States.TaskFailed", "Cause": "internal"},
        },
        None,
    )

    assert result["status"] == "STALE"
    queue.send_message.assert_not_called()


def test_failure_queue_omits_document_and_error_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    jobs = MagicMock()
    db = MagicMock()
    db.Table.return_value = jobs
    queue = MagicMock()
    monkeypatch.setattr(failure_handler, "dynamodb", db)
    monkeypatch.setattr(failure_handler, "sqs", queue)
    monkeypatch.setenv("JOBS_TABLE", "jobs")
    monkeypatch.setenv("DLQ_URL", "https://sqs.test/dlq")
    result = failure_handler.lambda_handler(
        {
            "job_id": "job-1",
            "owner_id": "tenant-a",
            "processing_attempt": 1,
            "raw_s3_key": "raw/tenant-a/job-1/document",
            "error": {"Error": "States.TaskFailed", "Cause": "private invoice content"},
        },
        None,
    )
    message = json.loads(queue.send_message.call_args.kwargs["MessageBody"])

    assert result["status"] == "FAILED"
    assert message == {
        "job_id": "job-1",
        "error_code": "PROCESSING_FAILED",
        "failed_at": result["failed_at"],
    }
    assert "private invoice content" not in queue.send_message.call_args.kwargs["MessageBody"]
