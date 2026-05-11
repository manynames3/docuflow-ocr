from __future__ import annotations

import json
import os
from typing import Any

import boto3

s3 = boto3.client("s3")
textract = boto3.client("textract")


def lambda_handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    job_id = event["textract_job_id"]
    first_page = textract.get_document_analysis(JobId=job_id, MaxResults=1000)
    status = first_page["JobStatus"]

    if status in {"IN_PROGRESS", "FAILED"}:
        return {**event, "textract_status": status}

    blocks = first_page.get("Blocks", [])
    next_token = first_page.get("NextToken")
    while next_token:
        page = textract.get_document_analysis(JobId=job_id, MaxResults=1000, NextToken=next_token)
        blocks.extend(page.get("Blocks", []))
        next_token = page.get("NextToken")

    raw_output = {
        "JobStatus": status,
        "DocumentMetadata": first_page.get("DocumentMetadata", {}),
        "AnalyzeDocumentModelVersion": first_page.get("AnalyzeDocumentModelVersion"),
        "Blocks": blocks,
        "Warnings": first_page.get("Warnings", []),
    }
    output_key = f"textract/{event['job_id']}/raw.json"
    s3.put_object(
        Bucket=os.environ["DOCUMENTS_BUCKET"],
        Key=output_key,
        Body=json.dumps(raw_output).encode("utf-8"),
        ContentType="application/json",
    )

    return {
        **event,
        "textract_status": status,
        "textract_s3_key": output_key,
        "textract_block_count": len(blocks),
    }
