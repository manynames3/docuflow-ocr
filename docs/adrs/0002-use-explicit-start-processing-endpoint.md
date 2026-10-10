# ADR 0002: Use An Explicit Start-Processing Endpoint

## Status

Accepted

## Context

S3 event notifications could start processing after upload. The browser must also know that the upload completed before a job should be billed for OCR, and an explicit endpoint provides a clear transition from customer upload to processing.

## Decision

Use `POST /jobs/{job_id}/start` after the client uploads the document to the presigned S3 URL.

## Consequences

The API verifies ownership and confirms that the uploaded object exists before starting the workflow. The client makes one additional API call after upload, and retry behavior is explicit.

