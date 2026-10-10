from __future__ import annotations

import json
import os
from typing import Any

import boto3
from botocore.exceptions import ClientError
from docuflow.dynamo import from_dynamo
from docuflow.timeutils import utc_now_iso

dynamodb = boto3.resource("dynamodb")
sqs = boto3.client("sqs")


def lambda_handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    now = utc_now_iso()
    job_id = event.get("job_id")
    workflow_error = event.get("error") or {}
    failure_code = (
        "DOCUMENT_INVALID"
        if workflow_error.get("Error") == "InvalidDocumentError"
        else "PROCESSING_FAILED"
    )

    if job_id and event.get("owner_id"):
        table = dynamodb.Table(os.environ["JOBS_TABLE"])
        attempt = int(event["processing_attempt"])
        try:
            table.update_item(
                Key={"job_id": job_id},
                UpdateExpression="SET #status = :status, updated_at = :now, failure = :failure",
                ConditionExpression=(
                    "owner_id = :owner AND #status = :processing AND processing_attempt = :attempt"
                ),
                ExpressionAttributeNames={"#status": "status"},
                ExpressionAttributeValues={
                    ":owner": event["owner_id"],
                    ":processing": "PROCESSING",
                    ":attempt": attempt,
                    ":status": "FAILED",
                    ":now": now,
                    ":failure": {"code": failure_code},
                },
            )
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
                raise
            current = from_dynamo(table.get_item(Key={"job_id": job_id}).get("Item"))
            if not (
                current
                and current.get("owner_id") == event["owner_id"]
                and int(current.get("processing_attempt", -1)) == attempt
                and current.get("status") == "FAILED"
                and current.get("failure", {}).get("code") == failure_code
            ):
                return {"job_id": job_id, "status": "STALE", "error_code": failure_code}

    sqs.send_message(
        QueueUrl=os.environ["DLQ_URL"],
        MessageBody=json.dumps({"job_id": job_id, "error_code": failure_code, "failed_at": now}),
    )
    return {"job_id": job_id, "status": "FAILED", "failed_at": now, "error_code": failure_code}
