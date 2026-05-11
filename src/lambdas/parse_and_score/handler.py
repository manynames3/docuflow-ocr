from __future__ import annotations

import json
import os
from typing import Any

import boto3
from docuflow.confidence import required_field_list, score_extraction
from docuflow.dynamo import to_dynamo
from docuflow.parser import parse_textract_response
from docuflow.timeutils import utc_now_iso

s3 = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")


def lambda_handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    raw_object = s3.get_object(Bucket=os.environ["DOCUMENTS_BUCKET"], Key=event["textract_s3_key"])
    textract_response = json.loads(raw_object["Body"].read().decode("utf-8"))
    parsed = parse_textract_response(textract_response)
    score = score_extraction(
        parsed,
        threshold=float(os.environ.get("CONFIDENCE_THRESHOLD", "85")),
        required_fields=required_field_list(os.environ.get("REQUIRED_FIELDS")),
    )

    now = utc_now_iso()
    table = dynamodb.Table(os.environ["JOBS_TABLE"])
    table.update_item(
        Key={"job_id": event["job_id"]},
        UpdateExpression=(
            "SET #status = :status, updated_at = :now, parsed_fields = :fields, "
            "key_values = :key_values, confidence = :confidence, textract_s3_key = :textract_s3_key, "
            "review_reasons = :review_reasons"
        ),
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues=to_dynamo(
            {
                ":status": score["status"],
                ":now": now,
                ":fields": parsed["fields"],
                ":key_values": parsed["key_values"],
                ":confidence": score,
                ":textract_s3_key": event["textract_s3_key"],
                ":review_reasons": score["review_reasons"],
            }
        ),
    )

    return {
        **event,
        "status": score["status"],
        "confidence": score,
        "field_count": parsed["metrics"]["field_count"],
    }
