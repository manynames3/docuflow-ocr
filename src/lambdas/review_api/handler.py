from __future__ import annotations

import os
import uuid
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key
from docuflow.confidence import status_for_review_decision
from docuflow.dynamo import from_dynamo, to_dynamo
from docuflow.http import json_response, parse_json_body, path_param, route_key
from docuflow.timeutils import utc_now_iso

dynamodb = boto3.resource("dynamodb")


def _jobs_table():
    return dynamodb.Table(os.environ["JOBS_TABLE"])


def _audit_table():
    return dynamodb.Table(os.environ["AUDIT_TABLE"])


def _get_job(job_id: str) -> dict[str, Any] | None:
    response = _jobs_table().get_item(Key={"job_id": job_id})
    return from_dynamo(response.get("Item"))


def _job_response(job_id: str) -> dict[str, Any]:
    item = _get_job(job_id)
    if not item:
        return json_response(404, {"message": "job not found", "job_id": job_id})
    return json_response(200, {"job": item})


def _list_review_queue() -> dict[str, Any]:
    response = _jobs_table().query(
        IndexName="status-created_at-index",
        KeyConditionExpression=Key("status").eq("NEEDS_REVIEW"),
        Limit=50,
        ScanIndexForward=True,
    )
    return json_response(200, {"jobs": from_dynamo(response.get("Items", []))})


def _submit_decision(job_id: str, event: dict[str, Any]) -> dict[str, Any]:
    body = parse_json_body(event)
    decision = str(body.get("decision", ""))
    try:
        status = status_for_review_decision(decision)
    except ValueError as exc:
        return json_response(400, {"message": str(exc)})

    now = utc_now_iso()
    reviewer = str(body.get("reviewer") or "demo-reviewer")
    corrected_fields = body.get("corrected_fields") or {}
    comment = body.get("comment")

    _jobs_table().update_item(
        Key={"job_id": job_id},
        UpdateExpression=(
            "SET #status = :status, updated_at = :now, reviewed_at = :now, reviewer = :reviewer, "
            "corrected_fields = :corrected_fields, review_comment = :comment"
        ),
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues=to_dynamo(
            {
                ":status": status,
                ":now": now,
                ":reviewer": reviewer,
                ":corrected_fields": corrected_fields,
                ":comment": comment,
            }
        ),
    )
    _audit_table().put_item(
        Item=to_dynamo(
            {
                "audit_id": str(uuid.uuid4()),
                "job_id": job_id,
                "event_type": status,
                "reviewer": reviewer,
                "corrected_fields": corrected_fields,
                "comment": comment,
                "created_at": now,
            }
        )
    )

    return json_response(200, {"job_id": job_id, "status": status})


def lambda_handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    route = route_key(event)
    job_id = path_param(event, "job_id")

    if route == "GET /review/jobs":
        return _list_review_queue()

    if route in {"GET /jobs/{job_id}", "GET /jobs/{job_id}/result", "GET /review/jobs/{job_id}"}:
        if not job_id:
            return json_response(400, {"message": "job_id path parameter is required"})
        return _job_response(job_id)

    if route == "POST /review/jobs/{job_id}/decision":
        if not job_id:
            return json_response(400, {"message": "job_id path parameter is required"})
        return _submit_decision(job_id, event)

    return json_response(404, {"message": "route not found", "route": route})
