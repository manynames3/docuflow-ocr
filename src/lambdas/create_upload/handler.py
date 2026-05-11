from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Any

import boto3
from docuflow.constants import SUPPORTED_EXTENSIONS
from docuflow.dynamo import to_dynamo
from docuflow.http import json_response, parse_json_body
from docuflow.timeutils import utc_now_iso

s3 = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")


def _safe_filename(filename: str) -> str:
    return filename.replace("\\", "/").split("/")[-1].strip()


def lambda_handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    try:
        body = parse_json_body(event)
        filename = _safe_filename(str(body.get("filename", "")))
        if not filename:
            return json_response(400, {"message": "filename is required"})

        extension = Path(filename).suffix.lower()
        if extension not in SUPPORTED_EXTENSIONS:
            return json_response(
                400,
                {
                    "message": "unsupported file type",
                    "supported_extensions": sorted(SUPPORTED_EXTENSIONS),
                },
            )

        owner_id = str(body.get("owner_id") or "demo-owner")
        content_type = str(body.get("content_type") or "application/octet-stream")
        job_id = str(uuid.uuid4())
        now = utc_now_iso()
        bucket = os.environ["DOCUMENTS_BUCKET"]
        table = dynamodb.Table(os.environ["JOBS_TABLE"])
        object_key = f"raw/{owner_id}/{job_id}/{filename}"

        item = {
            "job_id": job_id,
            "document_id": job_id,
            "owner_id": owner_id,
            "filename": filename,
            "bucket": bucket,
            "raw_s3_key": object_key,
            "status": "CREATED",
            "created_at": now,
            "updated_at": now,
        }
        table.put_item(Item=to_dynamo(item))

        expires = int(os.environ.get("UPLOAD_TTL_SECONDS", "900"))
        upload_url = s3.generate_presigned_url(
            "put_object",
            Params={"Bucket": bucket, "Key": object_key, "ContentType": content_type},
            ExpiresIn=expires,
        )

        return json_response(
            201,
            {
                "job_id": job_id,
                "document_id": job_id,
                "upload_url": upload_url,
                "upload_method": "PUT",
                "upload_headers": {"content-type": content_type},
                "raw_s3_key": object_key,
                "expires_in_seconds": expires,
            },
        )
    except ValueError as exc:
        return json_response(400, {"message": str(exc)})
