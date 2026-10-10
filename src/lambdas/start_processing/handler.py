from __future__ import annotations

import json
import os
from typing import Any

import boto3
from botocore.exceptions import ClientError
from docuflow.auth import subject
from docuflow.dynamo import from_dynamo
from docuflow.http import json_response, path_param
from docuflow.timeutils import utc_now_iso

dynamodb = boto3.resource("dynamodb")
sfn = boto3.client("stepfunctions")


def lambda_handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    job_id = path_param(event, "job_id")
    if not job_id:
        return json_response(400, {"message": "job_id path parameter is required"})

    try:
        owner_id = subject(event)
    except PermissionError as exc:
        return json_response(401, {"message": str(exc)})

    table = dynamodb.Table(os.environ["JOBS_TABLE"])
    response = table.get_item(Key={"job_id": job_id})
    item = from_dynamo(response.get("Item"))
    if not item or item.get("owner_id") != owner_id:
        return json_response(404, {"message": "job not found", "job_id": job_id})

    if item.get("status") in {"PROCESSING", "COMPLETED", "NEEDS_REVIEW", "APPROVED", "REJECTED"}:
        return json_response(202, {"job_id": job_id, "status": item["status"]})

    max_bytes = int(os.environ.get("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
    try:
        uploaded = boto3.client("s3").head_object(Bucket=item["bucket"], Key=item["raw_s3_key"])
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
            return json_response(409, {"message": "Upload the invoice before starting processing."})
        raise
    if uploaded.get("ContentLength", 0) > max_bytes:
        return json_response(413, {"message": "This invoice exceeds the maximum file size."})
    if int(uploaded.get("ContentLength", 0)) != int(item.get("content_length", -1)):
        return json_response(
            409, {"message": "The uploaded file does not match this invoice request."}
        )
    if uploaded.get("ContentType") != item.get("content_type"):
        return json_response(
            409, {"message": "The uploaded file type does not match this invoice request."}
        )

    now = utc_now_iso()
    try:
        updated = table.update_item(
            Key={"job_id": job_id},
            UpdateExpression=(
                "SET #status = :processing, updated_at = :now, processing_started_at = :now, "
                "processing_attempt = if_not_exists(processing_attempt, :zero) + :one REMOVE failure"
            ),
            ConditionExpression="owner_id = :owner AND (#status = :created OR #status = :failed)",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":owner": owner_id,
                ":processing": "PROCESSING",
                ":created": "CREATED",
                ":failed": "FAILED",
                ":now": now,
                ":zero": 0,
                ":one": 1,
            },
            ReturnValues="ALL_NEW",
        )
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
            raise
        latest = from_dynamo(table.get_item(Key={"job_id": job_id}).get("Item")) or {}
        if latest.get("owner_id") != owner_id:
            return json_response(404, {"message": "job not found", "job_id": job_id})
        if latest.get("status") == "PROCESSING":
            return json_response(202, {"job_id": job_id, "status": "PROCESSING"})
        return json_response(
            409, {"message": "This invoice cannot be processed from its current state."}
        )

    attempt = int(updated["Attributes"]["processing_attempt"])
    try:
        sfn.start_execution(
            stateMachineArn=os.environ["STATE_MACHINE_ARN"],
            name=f"{job_id}-{attempt}",
            input=json.dumps(
                {
                    "job_id": job_id,
                    "document_id": item.get("document_id", job_id),
                    "owner_id": owner_id,
                    "bucket": item["bucket"],
                    "raw_s3_key": item["raw_s3_key"],
                    "filename": item["filename"],
                    "content_type": item["content_type"],
                    "processing_attempt": attempt,
                }
            ),
        )
    except ClientError:
        table.update_item(
            Key={"job_id": job_id},
            UpdateExpression="SET #status = :failed, updated_at = :now, failure = :failure",
            ConditionExpression=(
                "owner_id = :owner AND #status = :processing AND processing_attempt = :attempt"
            ),
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":owner": owner_id,
                ":attempt": attempt,
                ":processing": "PROCESSING",
                ":failed": "FAILED",
                ":now": utc_now_iso(),
                ":failure": {"code": "WORKFLOW_START_FAILED"},
            },
        )
        return json_response(
            503, {"message": "Processing could not start. You can retry this invoice."}
        )

    return json_response(
        202,
        {
            "job_id": job_id,
            "status": "PROCESSING",
        },
    )
