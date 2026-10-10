from __future__ import annotations

import hashlib
import hmac
import os
from typing import Any

import boto3
from botocore.exceptions import ClientError
from docuflow.documents import validate_document
from docuflow.dynamo import from_dynamo
from docuflow.timeutils import utc_now_iso

s3 = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")


class InvalidDocumentError(Exception):
    pass


def lambda_handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    bucket = event["bucket"]
    key = event["raw_s3_key"]
    owner_id = event["owner_id"]
    job_id = event["job_id"]
    max_bytes = int(os.environ.get("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
    max_pages = int(os.environ.get("MAX_DOCUMENT_PAGES", "5"))
    try:
        head = s3.head_object(Bucket=bucket, Key=key)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
            raise InvalidDocumentError("Upload the invoice before processing.") from exc
        raise
    content_length = int(head.get("ContentLength", 0))
    if content_length < 1 or content_length > max_bytes:
        raise InvalidDocumentError("The invoice is empty or exceeds the file size limit.")
    if head.get("ContentType") != event.get("content_type"):
        raise InvalidDocumentError("The uploaded file type does not match the selected file type.")
    response = s3.get_object(Bucket=bucket, Key=key)
    content = response["Body"].read(max_bytes + 1)
    if len(content) > max_bytes:
        raise ValueError("The invoice exceeds the file size limit.")
    try:
        page_count = validate_document(event["filename"], event["content_type"], content, max_pages)
    except ValueError as exc:
        raise InvalidDocumentError(str(exc)) from exc
    now = utc_now_iso()
    table = dynamodb.Table(os.environ["JOBS_TABLE"])
    current = from_dynamo(table.get_item(Key={"job_id": job_id}).get("Item"))
    attempt = int(event["processing_attempt"])
    if (
        not current
        or current.get("owner_id") != owner_id
        or int(current.get("processing_attempt", -1)) != attempt
    ):
        raise ValueError("Invoice record is no longer available.")
    expected_sha256 = current.get("upload_sha256")
    if not isinstance(expected_sha256, str) or not hmac.compare_digest(
        hashlib.sha256(content).hexdigest(), expected_sha256
    ):
        raise InvalidDocumentError("The uploaded content does not match the selected invoice.")
    if int(current.get("content_length", -1)) != content_length:
        raise InvalidDocumentError("The uploaded file does not match this invoice request.")
    table.update_item(
        Key={"job_id": event["job_id"]},
        UpdateExpression=(
            "SET #status = :status, uploaded_at = if_not_exists(uploaded_at, :now), "
            "updated_at = :now, content_length = :content_length, content_type = :content_type, "
            "page_count = :page_count"
        ),
        ConditionExpression=(
            "owner_id = :owner AND #status = :processing AND processing_attempt = :attempt"
        ),
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={
            ":owner": owner_id,
            ":processing": "PROCESSING",
            ":attempt": attempt,
            ":status": "PROCESSING",
            ":now": now,
            ":content_length": content_length,
            ":content_type": head.get("ContentType"),
            ":page_count": page_count,
        },
    )

    return {
        **event,
        "validated": True,
        "content_length": content_length,
        "content_type": head.get("ContentType", "application/octet-stream"),
        "page_count": page_count,
    }
