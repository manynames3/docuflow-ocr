from __future__ import annotations

import json
import os
import time
from typing import Any

import boto3
from docuflow.dynamo import from_dynamo
from docuflow.http import json_response, path_param
from docuflow.timeutils import utc_now_iso

dynamodb = boto3.resource("dynamodb")
sfn = boto3.client("stepfunctions")


def lambda_handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    job_id = path_param(event, "job_id")
    if not job_id:
        return json_response(400, {"message": "job_id path parameter is required"})

    table = dynamodb.Table(os.environ["JOBS_TABLE"])
    response = table.get_item(Key={"job_id": job_id})
    item = from_dynamo(response.get("Item"))
    if not item:
        return json_response(404, {"message": "job not found", "job_id": job_id})

    if item.get("status") in {"PROCESSING", "COMPLETED", "APPROVED"}:
        return json_response(
            409,
            {"message": "job cannot be started from current status", "status": item.get("status")},
        )

    now = utc_now_iso()
    table.update_item(
        Key={"job_id": job_id},
        UpdateExpression="SET #status = :status, updated_at = :now, processing_started_at = :now",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={":status": "PROCESSING", ":now": now},
    )

    execution = sfn.start_execution(
        stateMachineArn=os.environ["STATE_MACHINE_ARN"],
        name=f"{job_id}-{int(time.time())}",
        input=json.dumps(
            {
                "job_id": job_id,
                "document_id": item.get("document_id", job_id),
                "owner_id": item.get("owner_id"),
                "bucket": item["bucket"],
                "raw_s3_key": item["raw_s3_key"],
            }
        ),
    )

    return json_response(
        202,
        {
            "job_id": job_id,
            "status": "PROCESSING",
            "execution_arn": execution["executionArn"],
        },
    )
