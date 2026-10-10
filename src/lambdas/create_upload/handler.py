from __future__ import annotations

import os
import re
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import boto3
from botocore.exceptions import ClientError
from docuflow.auth import subject
from docuflow.constants import SUPPORTED_MIME_TYPES
from docuflow.dynamo import from_dynamo, to_dynamo
from docuflow.http import json_response, parse_json_body, path_param, request_header, route_key
from docuflow.timeutils import retention_expiry, utc_now_iso

s3 = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")


def _safe_filename(filename: str) -> str:
    name = filename.replace("\\", "/").split("/")[-1].strip()
    return re.sub(r"[^A-Za-z0-9._ -]", "_", name)[:120]


def _create_upload_url(
    bucket: str, key: str, content_type: str, max_bytes: int, sha256: str
) -> dict[str, Any]:
    return s3.generate_presigned_post(
        Bucket=bucket,
        Key=key,
        Fields={"Content-Type": content_type, "x-amz-meta-sha256": sha256},
        Conditions=[
            {"Content-Type": content_type},
            {"x-amz-meta-sha256": sha256},
            ["content-length-range", 1, max_bytes],
        ],
        ExpiresIn=int(os.environ.get("UPLOAD_TTL_SECONDS", "900")),
    )


def _resume_upload(event: dict[str, Any]) -> dict[str, Any]:
    owner_id = subject(event)
    job_id = path_param(event, "job_id")
    if not job_id:
        return json_response(400, {"message": "job_id path parameter is required"})

    sha256 = str(parse_json_body(event).get("sha256") or "").lower()
    if not re.fullmatch(r"[a-f0-9]{64}", sha256):
        return json_response(400, {"message": "A valid invoice checksum is required."})

    table = dynamodb.Table(os.environ["JOBS_TABLE"])
    result = table.get_item(Key={"job_id": job_id}, ConsistentRead=True)
    item = from_dynamo(result.get("Item"))
    if not item or item.get("owner_id") != owner_id:
        return json_response(404, {"message": "Invoice not found."})
    status = item.get("status")
    if status != "CREATED":
        if status not in {
            "PROCESSING",
            "COMPLETED",
            "NEEDS_REVIEW",
            "FAILED",
            "APPROVED",
            "REJECTED",
        }:
            return json_response(
                409, {"message": "This invoice is no longer available for upload."}
            )
        if item.get("upload_sha256") != sha256:
            return json_response(
                409,
                {
                    "code": "UPLOAD_CHECKSUM_MISMATCH",
                    "message": "The selected file does not match this invoice.",
                },
            )
        return json_response(
            200,
            {
                "job_id": job_id,
                "status": status,
                "upload_required": False,
                "upload_url": None,
                "upload_fields": None,
            },
        )
    if item.get("upload_sha256") != sha256:
        return json_response(
            409,
            {
                "code": "UPLOAD_CHECKSUM_MISMATCH",
                "message": "The selected file does not match this invoice.",
            },
        )

    bucket = os.environ["DOCUMENTS_BUCKET"]
    key = f"raw/{owner_id}/{job_id}/document"
    try:
        uploaded = s3.head_object(Bucket=bucket, Key=key)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") not in {"404", "NoSuchKey", "NotFound"}:
            raise
        uploaded = None

    if uploaded:
        matches = (
            int(uploaded.get("ContentLength", 0)) == int(item.get("content_length", -1))
            and uploaded.get("ContentType") == item.get("content_type")
            and uploaded.get("Metadata", {}).get("sha256") == sha256
        )
        if not matches:
            return json_response(
                409,
                {
                    "message": "The stored upload does not match this invoice. Delete it and upload again."
                },
            )
        return json_response(
            200,
            {
                "job_id": job_id,
                "status": "CREATED",
                "upload_required": False,
                "upload_url": None,
                "upload_fields": None,
            },
        )

    max_bytes = int(os.environ.get("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
    upload = _create_upload_url(bucket, key, item["content_type"], max_bytes, sha256)
    return json_response(
        200,
        {
            "job_id": job_id,
            "status": "CREATED",
            "upload_required": True,
            "upload_url": upload["url"],
            "upload_fields": upload["fields"],
            "expires_in_seconds": int(os.environ.get("UPLOAD_TTL_SECONDS", "900")),
        },
    )


def lambda_handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    try:
        if route_key(event) == "POST /jobs/{job_id}/upload-url":
            return _resume_upload(event)

        body = parse_json_body(event)
        owner_id = subject(event)
        filename = _safe_filename(str(body.get("filename", "")))
        if not filename:
            return json_response(400, {"message": "filename is required"})

        extension = Path(filename).suffix.lower()
        content_type = str(body.get("content_type") or "").lower()
        if extension not in SUPPORTED_MIME_TYPES or SUPPORTED_MIME_TYPES[extension] != content_type:
            return json_response(400, {"message": "Choose a PDF, PNG, or JPEG invoice."})

        try:
            content_length = int(body.get("file_size", 0))
        except (TypeError, ValueError):
            return json_response(400, {"message": "file_size must be a number"})
        max_bytes = int(os.environ.get("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
        if content_length < 1 or content_length > max_bytes:
            return json_response(
                413,
                {
                    "message": f"Invoices must be between 1 byte and {max_bytes // (1024 * 1024)} MB."
                },
            )

        sha256 = str(body.get("sha256") or "").lower()
        if not re.fullmatch(r"[a-f0-9]{64}", sha256):
            return json_response(400, {"message": "A valid invoice checksum is required."})

        idempotency_key = request_header(event, "idempotency-key")
        if not idempotency_key or not re.fullmatch(r"[A-Za-z0-9._:-]{16,128}", idempotency_key):
            return json_response(400, {"message": "A valid Idempotency-Key header is required."})

        job_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"docuflow:{owner_id}:{idempotency_key}"))
        now = utc_now_iso()
        bucket = os.environ["DOCUMENTS_BUCKET"]
        table = dynamodb.Table(os.environ["JOBS_TABLE"])
        object_key = f"raw/{owner_id}/{job_id}/document"

        item = {
            "job_id": job_id,
            "document_id": job_id,
            "owner_id": owner_id,
            "filename": filename,
            "content_type": content_type,
            "content_length": content_length,
            "upload_sha256": sha256,
            "bucket": bucket,
            "raw_s3_key": object_key,
            "status": "CREATED",
            "created_at": now,
            "updated_at": now,
            "expires_at": retention_expiry(int(os.environ.get("DOCUMENT_RETENTION_DAYS", "30"))),
        }
        created = True
        try:
            table.put_item(Item=to_dynamo(item), ConditionExpression="attribute_not_exists(job_id)")
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
                raise
            created = False
            item = table.get_item(Key={"job_id": job_id}, ConsistentRead=True).get("Item") or {}
            if (
                item.get("owner_id") != owner_id
                or item.get("filename") != filename
                or item.get("content_type") != content_type
                or int(item.get("content_length", 0)) != content_length
                or item.get("upload_sha256") != sha256
            ):
                return json_response(
                    409, {"message": "This request key was already used for another invoice."}
                )

        if created:
            today = datetime.now(UTC).date()
            tomorrow = datetime.combine(today + timedelta(days=1), datetime.min.time(), UTC)
            quota_table = dynamodb.Table(os.environ["QUOTAS_TABLE"])
            try:
                quota_table.update_item(
                    Key={"quota_key": f"{owner_id}:{today.isoformat()}"},
                    UpdateExpression="SET expires_at = if_not_exists(expires_at, :expires) ADD upload_count :one",
                    ConditionExpression="attribute_not_exists(upload_count) OR upload_count < :maximum",
                    ExpressionAttributeValues={
                        ":expires": int((tomorrow + timedelta(days=1)).timestamp()),
                        ":one": 1,
                        ":maximum": int(os.environ.get("MAX_DAILY_UPLOADS", "5")),
                    },
                )
            except ClientError as exc:
                table.delete_item(
                    Key={"job_id": job_id},
                    ConditionExpression="owner_id = :owner",
                    ExpressionAttributeValues={":owner": owner_id},
                )
                if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
                    return json_response(
                        429,
                        {
                            "message": "This account has reached its daily invoice limit. Try again tomorrow."
                        },
                    )
                raise

        expires = int(os.environ.get("UPLOAD_TTL_SECONDS", "900"))
        status = item.get("status", "CREATED")
        upload = None
        if status in {"CREATED", "FAILED"}:
            upload = _create_upload_url(bucket, object_key, content_type, max_bytes, sha256)

        return json_response(
            201 if created else 200,
            {
                "job_id": job_id,
                "document_id": job_id,
                "status": status,
                "upload_required": upload is not None,
                "upload_url": upload["url"] if upload else None,
                "upload_fields": upload["fields"] if upload else None,
                "expires_in_seconds": expires if upload else None,
            },
        )
    except PermissionError as exc:
        return json_response(401, {"message": str(exc)})
    except ValueError as exc:
        return json_response(400, {"message": str(exc)})
