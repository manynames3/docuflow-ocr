from __future__ import annotations

import csv
import io
import json
import os
import uuid
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError
from docuflow.auth import claims, subject
from docuflow.confidence import status_for_review_decision
from docuflow.documents import field_value
from docuflow.dynamo import from_dynamo, to_dynamo
from docuflow.http import json_response, parse_json_body, path_param, route_key, text_response
from docuflow.timeutils import retention_expiry, utc_now_iso

dynamodb = boto3.resource("dynamodb")
s3 = boto3.client("s3")
EDITABLE_FIELDS = {
    "vendor_name",
    "invoice_number",
    "document_date",
    "due_date",
    "total_amount",
    "currency",
    "purchase_order",
    "tax_amount",
    "billing_address",
}
EXPORT_FIELDS = (
    "vendor_name",
    "invoice_number",
    "document_date",
    "due_date",
    "total_amount",
    "currency",
)


def _jobs_table():
    return dynamodb.Table(os.environ["JOBS_TABLE"])


def _audit_table():
    return dynamodb.Table(os.environ["AUDIT_TABLE"])


def _get_job(job_id: str) -> dict[str, Any] | None:
    item = _jobs_table().get_item(Key={"job_id": job_id}).get("Item")
    return from_dynamo(item) if item else None


def _owned_job(job_id: str, owner_id: str) -> dict[str, Any] | None:
    item = _get_job(job_id)
    return item if item and item.get("owner_id") == owner_id else None


def _public_job(item: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in item.items()
        if key not in {"owner_id", "bucket", "raw_s3_key", "textract_s3_key", "upload_sha256"}
    }


def _audit(
    owner_id: str, job_id: str, event_type: str, details: dict[str, Any] | None = None
) -> None:
    _audit_table().put_item(
        Item=to_dynamo(
            {
                "audit_id": str(uuid.uuid4()),
                "job_id": job_id,
                "owner_id": owner_id,
                "event_type": event_type,
                "details": details or {},
                "created_at": utc_now_iso(),
                "expires_at": retention_expiry(
                    int(os.environ.get("DOCUMENT_RETENTION_DAYS", "30"))
                ),
            }
        )
    )


def _list_jobs(owner_id: str, event: dict[str, Any]) -> dict[str, Any]:
    token = ((event.get("queryStringParameters") or {}).get("next_token") or "").strip()
    start_key = None
    if token:
        import base64

        try:
            start_key = json.loads(
                base64.urlsafe_b64decode(token.encode("ascii") + b"=" * (-len(token) % 4))
            )
            if start_key.get("owner_id") != owner_id:
                raise ValueError
        except (ValueError, json.JSONDecodeError, UnicodeError):
            return json_response(400, {"message": "The invoice history cursor is invalid."})
    response = _jobs_table().query(
        IndexName="owner_id-created_at-index",
        KeyConditionExpression=Key("owner_id").eq(owner_id),
        Limit=100,
        ScanIndexForward=False,
        **({"ExclusiveStartKey": start_key} if start_key else {}),
    )
    next_token = None
    if response.get("LastEvaluatedKey"):
        import base64

        next_token = (
            base64.urlsafe_b64encode(
                json.dumps(response["LastEvaluatedKey"], separators=(",", ":")).encode("utf-8")
            )
            .decode("ascii")
            .rstrip("=")
        )
    return json_response(
        200,
        {
            "jobs": [_public_job(item) for item in from_dynamo(response.get("Items", []))],
            "next_token": next_token,
        },
    )


def _get_job_response(job_id: str, owner_id: str) -> dict[str, Any]:
    item = _owned_job(job_id, owner_id)
    if not item:
        return json_response(404, {"message": "Invoice not found."})
    return json_response(200, {"job": _public_job(item)})


def _get_document(job_id: str, owner_id: str) -> dict[str, Any]:
    item = _owned_job(job_id, owner_id)
    if not item or item.get("status") == "DELETING":
        return json_response(404, {"message": "Invoice not found."})
    try:
        s3.head_object(Bucket=item["bucket"], Key=item["raw_s3_key"])
        url = s3.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": item["bucket"],
                "Key": item["raw_s3_key"],
                "ResponseContentType": item.get("content_type", "application/octet-stream"),
                "ResponseContentDisposition": 'inline; filename="invoice-document"',
            },
            ExpiresIn=300,
        )
    except ClientError:
        return json_response(503, {"message": "The original invoice is temporarily unavailable."})
    return json_response(200, {"url": url, "expires_in_seconds": 300})


def _get_history(job_id: str, owner_id: str) -> dict[str, Any]:
    if not _owned_job(job_id, owner_id):
        return json_response(404, {"message": "Invoice not found."})
    response = _audit_table().query(
        IndexName="job_id-index",
        KeyConditionExpression=Key("job_id").eq(job_id),
        ScanIndexForward=False,
    )
    entries = [
        {key: value for key, value in item.items() if key != "owner_id"}
        for item in from_dynamo(response.get("Items", []))
        if item.get("owner_id") == owner_id
    ]
    return json_response(200, {"history": entries})


def _save_review(job_id: str, owner_id: str, event: dict[str, Any]) -> dict[str, Any]:
    item = _owned_job(job_id, owner_id)
    if not item:
        return json_response(404, {"message": "Invoice not found."})
    if item.get("status") not in {"NEEDS_REVIEW", "COMPLETED"}:
        return json_response(409, {"message": "This invoice is not ready for review changes."})

    body = parse_json_body(event)
    corrected = body.get("corrected_fields")
    if not isinstance(corrected, dict) or len(corrected) > len(EDITABLE_FIELDS):
        return json_response(400, {"message": "Provide a valid set of invoice field corrections."})
    if any(
        key not in EDITABLE_FIELDS
        or not isinstance(value, (str, int, float))
        or len(str(value)) > 1000
        for key, value in corrected.items()
    ):
        return json_response(400, {"message": "One or more invoice field corrections are invalid."})

    previous = item.get("corrected_fields", {})
    corrected = {**previous, **{key: str(value) for key, value in corrected.items()}}
    changes = {
        key: {
            "from": previous.get(key, field_value(item.get("parsed_fields", {}).get(key))),
            "to": str(value),
        }
        for key, value in corrected.items()
        if str(previous.get(key, field_value(item.get("parsed_fields", {}).get(key)))) != str(value)
    }
    now = utc_now_iso()
    try:
        _jobs_table().update_item(
            Key={"job_id": job_id},
            UpdateExpression=(
                "SET corrected_fields = :fields, corrections_saved_at = :now, updated_at = :now "
                "ADD correction_version :one"
            ),
            ConditionExpression=(
                "owner_id = :owner AND (#status = :needs_review OR #status = :completed)"
            ),
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues=to_dynamo(
                {
                    ":owner": owner_id,
                    ":needs_review": "NEEDS_REVIEW",
                    ":completed": "COMPLETED",
                    ":fields": corrected,
                    ":now": now,
                    ":one": 1,
                }
            ),
        )
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return json_response(
                409,
                {
                    "message": "This invoice changed while you were reviewing it. Reload and try again."
                },
            )
        raise

    _audit(
        owner_id,
        job_id,
        "FIELDS_CORRECTED",
        {"changes": changes, "field_count": len(corrected)},
    )
    return json_response(200, {"job_id": job_id, "saved_at": now, "corrected_fields": corrected})


def _submit_decision(job_id: str, owner_id: str, event: dict[str, Any]) -> dict[str, Any]:
    item = _owned_job(job_id, owner_id)
    if not item:
        return json_response(404, {"message": "Invoice not found."})
    body = parse_json_body(event)
    decision = str(body.get("decision", ""))
    try:
        status = status_for_review_decision(decision)
    except ValueError as exc:
        return json_response(400, {"message": str(exc)})
    if item.get("status") not in {"NEEDS_REVIEW", "COMPLETED", "APPROVED", "REJECTED"}:
        return json_response(409, {"message": "This invoice is not ready for a review decision."})
    if item.get("status") in {"APPROVED", "REJECTED"}:
        return json_response(409, {"message": "This invoice has already been finalized."})

    reviewer = claims(event).get("email", "customer")[:254]
    now = utc_now_iso()
    try:
        _jobs_table().update_item(
            Key={"job_id": job_id},
            UpdateExpression=(
                "SET #status = :status, updated_at = :now, reviewed_at = :now, reviewer = :reviewer"
            ),
            ConditionExpression=(
                "owner_id = :owner AND (#status = :needs_review OR #status = :completed)"
            ),
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":owner": owner_id,
                ":needs_review": "NEEDS_REVIEW",
                ":completed": "COMPLETED",
                ":status": status,
                ":now": now,
                ":reviewer": reviewer,
            },
        )
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return json_response(
                409,
                {
                    "message": "This invoice changed while you were reviewing it. Reload and try again."
                },
            )
        raise
    _audit(owner_id, job_id, status, {"reviewer": reviewer})
    return json_response(200, {"job_id": job_id, "status": status})


def _delete_job(job_id: str, owner_id: str) -> dict[str, Any]:
    item = _owned_job(job_id, owner_id)
    if not item:
        return json_response(404, {"message": "Invoice not found."})
    if item.get("status") == "PROCESSING":
        return json_response(
            409, {"message": "Wait for processing to finish before deleting this invoice."}
        )

    now = utc_now_iso()
    try:
        _jobs_table().update_item(
            Key={"job_id": job_id},
            UpdateExpression="SET #status = :deleting, updated_at = :now",
            ConditionExpression="owner_id = :owner AND #status <> :processing",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":owner": owner_id,
                ":processing": "PROCESSING",
                ":deleting": "DELETING",
                ":now": now,
            },
        )
        objects = {item["raw_s3_key"]}
        prefix = f"textract/{owner_id}/{job_id}/"
        continuation_token = None
        while True:
            page = s3.list_objects_v2(
                Bucket=item["bucket"],
                Prefix=prefix,
                **({"ContinuationToken": continuation_token} if continuation_token else {}),
            )
            objects.update(entry["Key"] for entry in page.get("Contents", []))
            continuation_token = page.get("NextContinuationToken")
            if not continuation_token:
                break
        keys = sorted(objects)
        for offset in range(0, len(keys), 1000):
            deleted = s3.delete_objects(
                Bucket=item["bucket"],
                Delete={
                    "Objects": [{"Key": key} for key in keys[offset : offset + 1000]],
                    "Quiet": True,
                },
            )
            if deleted.get("Errors"):
                return json_response(
                    503, {"message": "The invoice could not be deleted completely. Try again."}
                )
        start_key = None
        while True:
            audit = _audit_table().query(
                IndexName="job_id-index",
                KeyConditionExpression=Key("job_id").eq(job_id),
                **({"ExclusiveStartKey": start_key} if start_key else {}),
            )
            for entry in audit.get("Items", []):
                if entry.get("owner_id") == owner_id:
                    _audit_table().delete_item(Key={"audit_id": entry["audit_id"]})
            start_key = audit.get("LastEvaluatedKey")
            if not start_key:
                break
        _jobs_table().delete_item(
            Key={"job_id": job_id},
            ConditionExpression="owner_id = :owner AND #status = :deleting",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={":owner": owner_id, ":deleting": "DELETING"},
        )
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return json_response(
                409, {"message": "Processing started before deletion. Wait for it to finish."}
            )
        return json_response(
            503, {"message": "The invoice could not be deleted completely. Try again."}
        )
    return json_response(200, {"job_id": job_id, "deleted": True})


def _csv_safe(value: str) -> str:
    if value.startswith(("=", "+", "-", "@", "\t", "\r")):
        return "'" + value
    return value


def _export_csv(owner_id: str) -> dict[str, Any]:
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow([*EXPORT_FIELDS, "status", "created_at"])
    start_key = None
    while True:
        response = _jobs_table().query(
            IndexName="owner_id-created_at-index",
            KeyConditionExpression=Key("owner_id").eq(owner_id),
            ScanIndexForward=False,
            **({"ExclusiveStartKey": start_key} if start_key else {}),
        )
        for item in from_dynamo(response.get("Items", [])):
            if item.get("status") != "APPROVED":
                continue
            fields = item.get("parsed_fields", {})
            corrections = item.get("corrected_fields", {})
            values = [
                _csv_safe(str(corrections.get(name, field_value(fields.get(name)))))
                for name in EXPORT_FIELDS
            ]
            writer.writerow([*values, item.get("status", ""), item.get("created_at", "")])
        start_key = response.get("LastEvaluatedKey")
        if not start_key:
            break
    response = text_response(200, output.getvalue(), "text/csv; charset=utf-8; header=present")
    response["headers"]["content-disposition"] = 'attachment; filename="docuflow-invoices.csv"'
    return response


def lambda_handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    route = route_key(event)
    if route == "GET /health":
        return json_response(200, {"status": "ok"})
    try:
        owner_id = subject(event)
        if route == "GET /jobs":
            return _list_jobs(owner_id, event)
        if route == "GET /exports/invoices.csv":
            return _export_csv(owner_id)
        job_id = path_param(event, "job_id")
        if not job_id:
            return json_response(400, {"message": "Invoice ID is required."})
        if route == "GET /jobs/{job_id}":
            return _get_job_response(job_id, owner_id)
        if route == "GET /jobs/{job_id}/document":
            return _get_document(job_id, owner_id)
        if route == "GET /jobs/{job_id}/history":
            return _get_history(job_id, owner_id)
        if route == "PATCH /jobs/{job_id}/review":
            return _save_review(job_id, owner_id, event)
        if route == "POST /jobs/{job_id}/decision":
            return _submit_decision(job_id, owner_id, event)
        if route == "DELETE /jobs/{job_id}":
            return _delete_job(job_id, owner_id)
    except PermissionError as exc:
        return json_response(401, {"message": str(exc)})
    except (json.JSONDecodeError, ValueError) as exc:
        return json_response(400, {"message": str(exc)})
    return json_response(404, {"message": "Route not found."})
