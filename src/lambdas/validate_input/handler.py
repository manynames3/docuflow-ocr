from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import boto3
from docuflow.constants import SUPPORTED_EXTENSIONS
from docuflow.timeutils import utc_now_iso

s3 = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")


def lambda_handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    bucket = event["bucket"]
    key = event["raw_s3_key"]
    extension = Path(key).suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"unsupported file type: {extension}")

    head = s3.head_object(Bucket=bucket, Key=key)
    now = utc_now_iso()
    dynamodb.Table(os.environ["JOBS_TABLE"]).update_item(
        Key={"job_id": event["job_id"]},
        UpdateExpression=(
            "SET #status = :status, uploaded_at = if_not_exists(uploaded_at, :now), "
            "updated_at = :now, content_length = :content_length, content_type = :content_type"
        ),
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={
            ":status": "PROCESSING",
            ":now": now,
            ":content_length": head.get("ContentLength", 0),
            ":content_type": head.get("ContentType", "application/octet-stream"),
        },
    )

    return {
        **event,
        "validated": True,
        "content_length": head.get("ContentLength", 0),
        "content_type": head.get("ContentType", "application/octet-stream"),
    }
