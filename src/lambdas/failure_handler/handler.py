from __future__ import annotations

import json
import os
from typing import Any

import boto3
from docuflow.dynamo import to_dynamo
from docuflow.timeutils import utc_now_iso

dynamodb = boto3.resource("dynamodb")
sqs = boto3.client("sqs")


def lambda_handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    now = utc_now_iso()
    job_id = event.get("job_id")
    error = event.get("error") or {"message": "workflow failed"}

    if job_id:
        dynamodb.Table(os.environ["JOBS_TABLE"]).update_item(
            Key={"job_id": job_id},
            UpdateExpression="SET #status = :status, updated_at = :now, failure = :failure",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues=to_dynamo(
                {
                    ":status": "FAILED",
                    ":now": now,
                    ":failure": error,
                }
            ),
        )

    sqs.send_message(
        QueueUrl=os.environ["DLQ_URL"],
        MessageBody=json.dumps({"failed_at": now, "event": event}, default=str),
    )
    return {**event, "status": "FAILED", "failed_at": now}
