from __future__ import annotations

from typing import Any

import boto3

textract = boto3.client("textract")


def lambda_handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    client_token = f"{event['job_id']}-{event['processing_attempt']}"
    response = textract.start_document_analysis(
        DocumentLocation={
            "S3Object": {
                "Bucket": event["bucket"],
                "Name": event["raw_s3_key"],
            }
        },
        FeatureTypes=["FORMS", "TABLES"],
        ClientRequestToken=client_token,
    )
    return {**event, "textract_job_id": response["JobId"], "textract_status": "STARTED"}
